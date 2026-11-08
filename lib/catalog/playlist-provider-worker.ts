/** Independent provider scheduling; original job owns plans, identities and write intents.
 * Provider states never clear an intent, alter another provider's retry, or adopt an archive.
 * The shared parent lease deliberately serializes providers of the SAME festival.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { assertPlaylistRefreshLease, renewPlaylistRefreshLease, type PlaylistLease } from './playlist-queue.ts';
import { youtubeHoldReasons, playlistFailure, type PlaylistStage } from './playlist-failure.ts';
import {requestedProviders,type PlaylistProvider} from './playlist-provider-scope.ts';
export {requestedProviders,type PlaylistProvider} from './playlist-provider-scope.ts';
type ParentSchedule = { status: string; retryAt: string | null; startedAt: string | null; completedAt: string | null; lastError: string | null };
type ProviderState = { version: 1; provider: PlaylistProvider; jobId: string; status: 'PENDING'|'RUNNING'|'FAILED'|'BLOCKED'|'SUCCEEDED'; attempts: number; retryAt: string | null; diagnostic?: string; parent?: ParentSchedule; leaseOwner?: string; completedAt?: string };
const stateKey = (provider: PlaylistProvider, id: string) => `playlist-provider:v1:${provider}:${id}`;
export function providerRetryDelay(attempt: number, error: unknown) {
  const failure=error as {code?:unknown;stderr?:unknown};
  const lines=typeof failure?.stderr==='string'?failure.stderr.split('\n'):[];
  if ((failure?.code===2&&lines.includes('youtube_quota_bound_reached')) || (failure?.code===3&&lines.some(l=>['youtube_insert_readback_failed','youtube_metadata_readback_failed','youtube_delete_readback_failed'].includes(l)))) return 60_000;
  return Math.min(86_400_000,60_000*2**Math.min(attempt-1,11));
}
function schedule(row: {status:string;retryAt:Date|null;startedAt:Date|null;completedAt:Date|null;lastError:string|null}): ParentSchedule {
 return {status:row.status,retryAt:row.retryAt?.toISOString()??null,startedAt:row.startedAt?.toISOString()??null,completedAt:row.completedAt?.toISOString()??null,lastError:row.lastError};
}
function restore(before:ParentSchedule) {
 return {...before,status:before.status as 'PENDING'|'FAILED'|'SUCCEEDED',retryAt:before.retryAt?new Date(before.retryAt):null,startedAt:before.startedAt?new Date(before.startedAt):null,completedAt:before.completedAt?new Date(before.completedAt):null,leaseOwner:null,leaseExpiresAt:null};
}
async function claimProvider(db:PrismaClient, provider:PlaylistProvider) {
 // Select newest requested-provider publication BEFORE checking eligibility. Old generations must
 // never overwrite a newer one just because its other provider is blocked.
 if(provider==='youtube_music'){
  const block=await db.operationalState.findUnique({where:{key:'playlist-provider-quota:youtube_music:v1'}});
  const reset=(block?.payload as {resetAt?:string}|undefined)?.resetAt;
  if(reset&&new Date(reset)>new Date())return null;
 }
 const candidates=await db.$queryRaw<{id:string;festivalSlug:string}[]>`
  SELECT latest.id, latest."festivalSlug" FROM (
   SELECT DISTINCT ON (j."festivalSlug",p."editionYear") j.id,j."festivalSlug",j.status,j."requestedAt"
   FROM "CatalogPlaylistRefresh" j JOIN "CatalogPublication" p ON p.id=j."publicationId"
   JOIN "Festival" f ON f.slug=j."festivalSlug"
   JOIN "FestivalEdition" e ON e."festivalId"=f.id AND e.year=p."editionYear" AND e."recordState"='CURRENT'
   WHERE p."lineupChanged"=true AND (
    p.evidence IS NULL OR NOT (p.evidence ? 'providers')
    OR (jsonb_typeof(p.evidence->'providers')='array' AND (p.evidence->'providers') ? ${provider})
   )
   ORDER BY j."festivalSlug",p."editionYear",p."createdAt" DESC,j.id DESC
  ) latest WHERE latest.status<>'SUCCEEDED' AND NOT EXISTS (SELECT 1 FROM "OperationalState" held
   WHERE held.key='playlist-provider:v1:' || ${provider} || ':' || latest.id AND held.payload->>'status'='BLOCKED')
   ORDER BY latest."requestedAt" LIMIT 128`;
 for(const candidate of candidates){
  const result=await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(210,hashtext(${candidate.festivalSlug}))`;
   await tx.$queryRaw`SELECT id FROM "CatalogPlaylistRefresh" WHERE id=${candidate.id} FOR UPDATE`;
   const job=await tx.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:candidate.id},include:{publication:true}});
   if(!requestedProviders(job.publication.evidence).includes(provider))return null;
   const key=stateKey(provider,job.id);
   const record=await tx.operationalState.findUnique({where:{key}});
   let state=record?.payload as unknown as ProviderState|undefined;
   if(state&&(state.version!==1||state.provider!==provider||state.jobId!==job.id||!Number.isSafeInteger(state.attempts)||state.attempts<0))throw Error('Invalid provider state');
   const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
   // Recover only our OWN expired bridge lease, using its durable before-image.
   if(job.status==='RUNNING'){
    if(!state || state.status!=='RUNNING'||!state.parent||state.leaseOwner!==job.leaseOwner||!job.leaseExpiresAt||job.leaseExpiresAt>now)return null;
    await tx.catalogPlaylistRefresh.update({where:{id:job.id},data:restore(state.parent)});
    state={...state,status:'FAILED',retryAt:now.toISOString(),diagnostic:'provider_lease_expired'};
    Object.assign(job,restore(state.parent!));
   }
   if(job.status==='SUCCEEDED'||job.leaseOwner)return null;
   // A existing FAILED/null retry is a hold, NOT permission to resume a cancelled
   // or ambiguous task. Never infer cancellation from text or clear that hold.
   if(job.status==='FAILED'&&!job.retryAt)return null;
   if(await tx.catalogPlaylistRefresh.count({where:{festivalSlug:job.festivalSlug,id:{not:job.id},status:'RUNNING'}}))return null;
   if(!state)state={version:1,provider,jobId:job.id,status:'PENDING',attempts:0,retryAt:provider==='youtube_music'?job.retryAt?.toISOString()??null:null};
   if(state.status==='BLOCKED'||state.status==='SUCCEEDED'||(state.retryAt&&new Date(state.retryAt)>now))return null;
   const owner=randomUUID(),before=schedule(job);
   const running:ProviderState={...state,status:'RUNNING',attempts:state.attempts+1,parent:before,leaseOwner:owner};
   await tx.operationalState.upsert({where:{key},create:{key,payload:running as unknown as Prisma.InputJsonValue},update:{payload:running as unknown as Prisma.InputJsonValue}});
   const active=await tx.catalogPlaylistRefresh.update({where:{id:job.id},data:{status:'RUNNING',attempts:{increment:1},startedAt:now,leaseOwner:owner,leaseExpiresAt:new Date(now.getTime()+120_000)}});
   return {claim:{id:active.id,publicationId:active.publicationId,festivalSlug:active.festivalSlug,attempts:active.attempts,leaseOwner:owner,leaseExpiresAt:active.leaseExpiresAt!} satisfies PlaylistLease,state:running,key,providers:requestedProviders(job.publication.evidence)};
  });
  if(result)return result;
 }
 return null;
}
export async function runProviderWorker(db:PrismaClient,provider:PlaylistProvider,execute:(claim:PlaylistLease,guard:()=>Promise<void>,signal:AbortSignal)=>Promise<void>,stage:()=>PlaylistStage=()=> 'setup') {
 const selected=await claimProvider(db,provider);
 if(!selected)return {status:'IDLE',provider};
 const {claim,state,key,providers}=selected,abort=new AbortController();let lost:unknown;let renewal=Promise.resolve();
 const timer=setInterval(()=>{renewal=renewal.then(async()=>{try{await renewPlaylistRefreshLease(db,claim,120_000)}catch(e){lost=e;abort.abort()}})},30_000);
 const guard=async()=>{if(lost)throw lost;await assertPlaylistRefreshLease(db,claim)};
 let error:unknown;
 try{await guard();await execute(claim,guard,abort.signal);await guard()}catch(e){error=e;abort.abort()}
 finally{clearInterval(timer);await renewal}
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(210,hashtext(${claim.festivalSlug}))`;
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "CatalogPlaylistRefresh" WHERE id=${claim.id} AND status='RUNNING' AND "leaseOwner"=${claim.leaseOwner} AND attempts=${claim.attempts} AND "leaseExpiresAt">(clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
  if(rows.length!==1)throw Error('Provider lease lost; durable recovery required');
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  let retryAt=error?new Date(now.getTime()+providerRetryDelay(state.attempts,error)).toISOString():null;
  const lines=typeof (error as {stderr?:unknown})?.stderr==='string'?(error as {stderr:string}).stderr.split('\n'):[];
  if(provider==='youtube_music'&&lines.some(line=>['youtube_provider_quota_exceeded','youtube_provider_rejected_403_quotaExceeded'].includes(line))){
   const [{resetAt}]=await tx.$queryRaw<{resetAt:Date}[]>`SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles' AS "resetAt"`;
   retryAt=resetAt.toISOString();
   const payload={provider,reason:'quotaExceeded',status:403,reportedAt:now.toISOString(),resetAt:retryAt,jobId:claim.id};
   await tx.operationalState.upsert({where:{key:'playlist-provider-quota:youtube_music:v1'},create:{key:'playlist-provider-quota:youtube_music:v1',payload},update:{payload}});
  }
  // Only explicit identity/write ambiguity needs a permanent hold. Generic
  // reconciliation errors also cover transient read-only pagination anomalies.
  const blocked=provider==='youtube_music'&&(error as {code?:unknown})?.code===3
   &&lines.includes('youtube_reconciliation_required')&&lines.some(line=>youtubeHoldReasons.includes(line));
  if(blocked)retryAt=null;
  const done:ProviderState={version:1,provider,jobId:claim.id,status:blocked?'BLOCKED':error?'FAILED':'SUCCEEDED',attempts:state.attempts,retryAt,...(error?{diagnostic:playlistFailure(stage(),error)}:{completedAt:now.toISOString()})};
  await tx.operationalState.update({where:{key},data:{payload:done as unknown as Prisma.InputJsonValue}});
  let complete=true;
  for(const wanted of providers){const row=await tx.operationalState.findUnique({where:{key:stateKey(wanted,claim.id)}});if((row?.payload as unknown as ProviderState)?.status!=='SUCCEEDED')complete=false}
  await tx.catalogPlaylistRefresh.update({where:{id:claim.id},data:complete?{status:'SUCCEEDED',retryAt:null,completedAt:now,leaseOwner:null,leaseExpiresAt:null,lastError:null}:restore(state.parent!)});
 });
 return {status:error?'FAILED':'SUCCEEDED',provider,jobId:claim.id,...(error?{diagnostic:playlistFailure(stage(),error)}:{})};
}
