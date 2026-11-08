import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {requireLocalDisposableDatabase} from './support/disposable-db.ts';
import {runProviderWorker} from '../lib/catalog/playlist-provider-worker.ts';
import {assertPlaylistRefreshLease} from '../lib/catalog/playlist-queue.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db=new PrismaClient();
async function fixture(run:(value:{id:string;slug:string})=>Promise<void>,providers=['spotify','youtube_music']){
 const slug='provider-'+randomUUID();
 const f=await db.festival.create({data:{slug,name:'Synthetic',country:'Test',countryCode:'DE',genres:[],officialUrl:'https://example.test/',editions:{create:{year:2027,status:'PARTIAL',ticketStatus:'UNKNOWN',recordState:'CURRENT',completeness:'PARTIAL',sourceUpdatedAt:new Date()}}}});
 const p=await db.catalogPublication.create({data:{source:'ADMIN',sourceId:slug,festivalSlug:slug,editionYear:2027,actorLabel:'test',fields:['lineup'],lineupChanged:true,evidence:{providers}}});
 const j=await db.catalogPlaylistRefresh.create({data:{publicationId:p.id,festivalSlug:slug,requestedAt:new Date('1900-01-01')}});
 try{await run({id:j.id,slug})}finally{await db.catalogPlaylistRefresh.updateMany({where:{festivalSlug:slug},data:{status:'SUCCEEDED',leaseOwner:null,leaseExpiresAt:null}});await db.festival.delete({where:{id:f.id}})}
}
test.after(async()=>db.$disconnect());
test('Spotify completes despite YouTube existing backoff, preserving its plan, intent and schedule',()=>fixture(async({id})=>{
 const retryAt=new Date(Date.now()+86400000),youtubeState={pendingInsert:{playlistId:'PLsynthetic001',expectedIds:['00000000001'], beforeIds: (['00000000001']).slice(0,-1), position: (['00000000001']).length-1}};
 await db.catalogPlaylistRefresh.update({where:{id},data:{status:'FAILED',retryAt,youtubeState}});
 let spotify=0,youtube=0;
 const result=await runProviderWorker(db,'spotify',async(claim,guard)=>{spotify++;assert.equal(claim.id,id);await guard()});
 assert.equal(result.status,'SUCCEEDED');assert.equal(spotify,1);
 assert.equal((await runProviderWorker(db,'youtube_music',async()=>{youtube++})).status,'IDLE');assert.equal(youtube,0);
 const after=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}});assert.equal(after.status,'FAILED');assert.deepEqual(after.retryAt,retryAt);assert.deepEqual(after.youtubeState,youtubeState);
 assert.equal((await runProviderWorker(db,'spotify',async()=>{throw Error('already complete')})).status,'IDLE');
}));
test('one provider failure neither marks other succeeded nor carries its backoff into the other provider',()=>fixture(async({id})=>{
 assert.equal((await runProviderWorker(db,'youtube_music',async()=>{throw Error('synthetic refusal')})).status,'FAILED');
 let count=0;assert.equal((await runProviderWorker(db,'spotify',async()=>{count++})).status,'SUCCEEDED');assert.equal(count,1);
 assert.notEqual((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}})).status,'SUCCEEDED');
 assert.equal((await runProviderWorker(db,'youtube_music',async()=>{throw Error('backoff ignored')})).status,'IDLE');
}));
test('parent completes only after both requested providers; provider-only publications invoke only that provider',()=>fixture(async({id})=>{
 assert.equal((await runProviderWorker(db,'spotify',async()=>{})).status,'SUCCEEDED');
 assert.equal((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}})).status,'PENDING');
 assert.equal((await runProviderWorker(db,'youtube_music',async()=>{})).status,'SUCCEEDED');
 const after=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}});assert.equal(after.status,'SUCCEEDED');assert.equal(after.leaseOwner,null);
}));
test('YouTube-only publication never invokes Spotify executor',()=>fixture(async()=>{
 assert.equal((await runProviderWorker(db,'spotify',async()=>{throw Error('wrong provider')})).status,'IDLE');
 assert.equal((await runProviderWorker(db,'youtube_music',async()=>{})).status,'SUCCEEDED');
},['youtube_music']));
test('null-retry existing hold remains held for both providers',()=>fixture(async({id})=>{
 await db.catalogPlaylistRefresh.update({where:{id},data:{status:'FAILED',retryAt:null}});
 for(const provider of ['spotify','youtube_music'] as const)assert.equal((await runProviderWorker(db,provider,async()=>{throw Error('held job resumed')})).status,'IDLE');
}));
test('active same-festival lease blocks the other provider; different festivals proceed concurrently',()=>fixture(async({id})=>fixture(async({id:other})=>{
 await db.catalogPlaylistRefresh.update({where:{id},data:{requestedAt:new Date('1800-01-01')}});
 let release!:()=>void,ready!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>ready=r);
 const one=runProviderWorker(db,'spotify',async(claim)=>{assert.equal(claim.id,id);ready();await gate});
 await entered;
 const two=await runProviderWorker(db,'youtube_music',async(claim)=>assert.equal(claim.id,other));
 assert.equal(two.status,'SUCCEEDED');release();assert.equal((await one).status,'SUCCEEDED');
})));
test('expired own bridge lease is recovered from durable before-image, with pending intent intact',()=>fixture(async({id,slug})=>{
 const owner=randomUUID(),originalRetry=new Date(Date.now()+86400000),pending={pendingInsert:{playlistId:'PLsynthetic001',expectedIds:['00000000001'], beforeIds: (['00000000001']).slice(0,-1), position: (['00000000001']).length-1}};
 await db.catalogPlaylistRefresh.update({where:{id},data:{status:'RUNNING',attempts:1,leaseOwner:owner,startedAt:new Date(),leaseExpiresAt:new Date(Date.now()-1000),retryAt:originalRetry,youtubeState:pending}});
 const key=`playlist-provider:v1:spotify:${id}`;
 await db.operationalState.create({data:{key,payload:{version:1,provider:'spotify',jobId:id,status:'RUNNING',attempts:1,retryAt:null,leaseOwner:owner,parent:{status:'FAILED',retryAt:originalRetry.toISOString(),startedAt:null,completedAt:null,lastError:null}}}});
 assert.equal((await runProviderWorker(db,'spotify',async claim=>{await assertPlaylistRefreshLease(db,claim);assert.equal(claim.festivalSlug,slug)})).status,'SUCCEEDED');
 const after=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}});assert.deepEqual(after.youtubeState,pending);assert.equal(after.status,'FAILED');assert.deepEqual(after.retryAt,originalRetry);assert.equal(after.leaseOwner,null);
}));
test('newest publication is selected even when old generations have eligible retries',()=>fixture(async({id,slug})=>{
 const publication=await db.catalogPublication.create({data:{source:'ADMIN',sourceId:slug+'-new',festivalSlug:slug,editionYear:2027,actorLabel:'test',fields:['lineup'],lineupChanged:true,evidence:{providers:['spotify']}}});
 const newest=await db.catalogPlaylistRefresh.create({data:{publicationId:publication.id,festivalSlug:slug}});
 assert.equal((await runProviderWorker(db,'spotify',async claim=>assert.equal(claim.id,newest.id))).status,'SUCCEEDED');
 assert.equal((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}})).attempts,0);
}));
test('exact YouTube daily quota refusal blocks only YouTube until Pacific reset',()=>fixture(async()=>{
 try{
  const result=await runProviderWorker(db,'youtube_music',async()=>{throw Object.assign(new Error('rejected'),{code:1,stderr:'youtube_provider_rejected_403_quotaExceeded\n'})});
  assert.equal(result.status,'FAILED');
  const marker=await db.operationalState.findUniqueOrThrow({where:{key:'playlist-provider-quota:youtube_music:v1'}});
  assert.ok(new Date((marker.payload as {resetAt:string}).resetAt)>new Date());
  assert.equal((await runProviderWorker(db,'youtube_music',async()=>{throw Error('quota-blocked call')})).status,'IDLE');
  assert.equal((await runProviderWorker(db,'spotify',async()=>{})).status,'SUCCEEDED');
 }finally{await db.operationalState.deleteMany({where:{key:'playlist-provider-quota:youtube_music:v1'}})}
}));
test('retained-suffix intent roundtrips PostgreSQL JSONB, with strict order and confirmation checks',()=>fixture(async({slug})=>{
 const {stageYoutubePlan,youtubeProviderState}=await import('../lib/catalog/youtube-playlist-queue.ts');
 const ids=['00000000001','00000000002','00000000003'];
 assert.equal((await runProviderWorker(db,'youtube_music',async claim=>{
  const plan={slug,editionYear:2027,expectedUrl:'',title:'Synthetic 2027',description:'Synthetic',videoIds:ids,artists:1,sourceTracks:3};
  await stageYoutubePlan(db,claim,plan);
  await youtubeProviderState(db,claim,'','adopt',{playlistId:'PLsynthetic001',title:plan.title,description:plan.description});
  const intent={playlistId:'PLsynthetic001',expectedIds:ids,beforeIds:ids.slice(1),position:0};
  await youtubeProviderState(db,claim,'','insert',intent);
  const read=await youtubeProviderState(db,claim,'','read');assert.deepEqual(read.pendingInsert,intent);
  await youtubeProviderState(db,claim,'','confirm',intent);
  assert.equal((await youtubeProviderState(db,claim,'','read')).pendingInsert,null);
  await assert.rejects(youtubeProviderState(db,claim,'','insert',{...intent,expectedIds:[ids[0],ids[2],ids[1]],beforeIds:[ids[2],ids[1]]}),/retained order/);
 })).status,'SUCCEEDED');
},['youtube_music']));
test('completed YouTube-only generation neither hides nor supersedes unfinished Spotify',()=>fixture(async({id,slug})=>{
 const old=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}});
 const next=await db.catalogPublication.create({data:{source:'ADMIN',sourceId:slug+'-youtube',festivalSlug:slug,editionYear:2027,actorLabel:'test',fields:['lineup'],lineupChanged:true,evidence:{providers:['youtube_music']},createdAt:new Date(Date.now()+1000)}});
 await db.catalogPlaylistRefresh.create({data:{publicationId:next.id,festivalSlug:slug}});
 const {stageYoutubePlan}=await import('../lib/catalog/youtube-playlist-queue.ts');
 assert.equal((await runProviderWorker(db,'youtube_music',async claim=>{
  assert.equal(claim.publicationId,next.id);await stageYoutubePlan(db,claim,{slug,editionYear:2027,expectedUrl:'',title:'Synthetic 2027',description:'Synthetic',videoIds:['00000000001'],artists:1,sourceTracks:1});
 })).status,'SUCCEEDED');
 const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug},year:2027}}),url='https://open.spotify.com/playlist/'+'a'.repeat(22);
 await db.festivalPlaylist.create({data:{editionId:edition.id,provider:'spotify',url}});
 const {stagePlaylistPlan,assertSpotifyPlanCurrent}=await import('../lib/catalog/playlist-queue.ts');
 const {publishSpotifyCheckpoint}=await import('../lib/catalog/spotify-playlist-checkpoint.ts');
 assert.equal((await runProviderWorker(db,'spotify',async claim=>{
  assert.equal(claim.publicationId,old.publicationId);await stagePlaylistPlan(db,claim,{edition_year:2027,playlist_url:url,playlist_id:'a'.repeat(22),track_uris:['spotify:track:'+'b'.repeat(22)],track_count:1,artists_count:1});
  await assertSpotifyPlanCurrent(db,claim);await publishSpotifyCheckpoint(db,claim,{url,expectedUrl:url,artists:1,tracks:1});
 })).status,'SUCCEEDED');
}));
test('completed Spotify-only generation neither hides nor supersedes unfinished YouTube',()=>fixture(async({id,slug})=>{
 const old=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}});
 const next=await db.catalogPublication.create({data:{source:'ADMIN',sourceId:slug+'-spotify',festivalSlug:slug,editionYear:2027,actorLabel:'test',fields:['lineup'],lineupChanged:true,evidence:{providers:['spotify']},createdAt:new Date(Date.now()+1000)}});
 await db.catalogPlaylistRefresh.create({data:{publicationId:next.id,festivalSlug:slug}});
 const {stagePlaylistPlan}=await import('../lib/catalog/playlist-queue.ts');
 assert.equal((await runProviderWorker(db,'spotify',async claim=>{assert.equal(claim.publicationId,next.id);await stagePlaylistPlan(db,claim,{edition_year:2027,playlist_url:'',playlist_id:'',track_uris:['spotify:track:'+'b'.repeat(22)],track_count:1,artists_count:1})})).status,'SUCCEEDED');
 const {stageYoutubePlan,youtubeProviderState}=await import('../lib/catalog/youtube-playlist-queue.ts');
 assert.equal((await runProviderWorker(db,'youtube_music',async claim=>{
  assert.equal(claim.publicationId,old.publicationId);await stageYoutubePlan(db,claim,{slug,editionYear:2027,expectedUrl:'',title:'Synthetic 2027',description:'Synthetic',videoIds:['00000000001'],artists:1,sourceTracks:1});
  const state=await youtubeProviderState(db,claim,'','read');assert.equal(state.sent,false);
 })).status,'SUCCEEDED');
}));

test('unknown creation is held per provider without poisoning other festivals or changing the intent',()=>fixture(async({id})=>fixture(async({id:other})=>{
 await db.catalogPlaylistRefresh.update({where:{id},data:{requestedAt:new Date('1800-01-01'),youtubeState:{sent:true,playlistId:null,marker:'reserved-creation'}}});
 const before=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}});
 await runProviderWorker(db,'youtube_music',async claim=>{assert.equal(claim.id,id);throw Object.assign(new Error('unknown'),{code:3,stderr:'youtube_reconciliation_required\nyoutube_create_unknown_no_resend\n'})});
 const held=await db.operationalState.findUniqueOrThrow({where:{key:`playlist-provider:v1:youtube_music:${id}`}});
 assert.equal((held.payload as any).diagnostic,'playlist_worker_failed stage=setup reason=youtube_create_unknown_no_resend');
 assert.equal((held.payload as any).status,'BLOCKED');assert.equal((held.payload as any).retryAt,null);
 assert.equal((await runProviderWorker(db,'youtube_music',async claim=>assert.equal(claim.id,other))).status,'SUCCEEDED');
 assert.equal((await runProviderWorker(db,'spotify',async claim=>assert.equal(claim.id,id))).status,'SUCCEEDED');
 assert.deepEqual((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}})).youtubeState,before.youtubeState);
})));
test('bounded insert readback remains retryable rather than held',()=>fixture(async({id})=>{
 await runProviderWorker(db,'youtube_music',async()=>{throw Object.assign(new Error('readback'),{code:3,stderr:'youtube_reconciliation_required\nyoutube_insert_readback_failed\n'})});
 const row=await db.operationalState.findUniqueOrThrow({where:{key:`playlist-provider:v1:youtube_music:${id}`}});
 assert.equal((row.payload as any).status,'FAILED');assert.ok((row.payload as any).retryAt);
}));

test('malformed owned discovery backs off then retries; invalid created ID stays held with durable intent',()=>fixture(async({id})=>{
 const key=`playlist-provider:v1:youtube_music:${id}`;
 const diagnostic=(reason:string)=>Object.assign(new Error('synthetic invalid ID'),{code:3,stderr:`youtube_reconciliation_required\n${reason}\n`});
 const before=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}});
 const failed=await runProviderWorker(db,'youtube_music',async()=>{throw diagnostic('youtube_invalid_owned_discovery_id')},()=> 'youtube_apply');
 assert.equal(failed.status,'FAILED');
 let row=await db.operationalState.findUniqueOrThrow({where:{key}});
 const retry=row.payload as any;
 assert.equal(retry.status,'FAILED');assert.ok(new Date(retry.retryAt)>new Date());
 assert.equal(retry.diagnostic,'playlist_worker_failed stage=youtube_apply reason=youtube_invalid_owned_discovery_id');
 assert.deepEqual((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}})).youtubeState,before.youtubeState);
 assert.equal((await runProviderWorker(db,'youtube_music',async()=>{throw Error('backoff ignored')})).status,'IDLE');
 await db.operationalState.update({where:{key},data:{payload:{...retry,retryAt:new Date(Date.now()-1000).toISOString()}}});
 const intent={sent:true,playlistId:null,marker:'synthetic-reserved',creationMetadata:{title:'Synthetic 2027',description:'Synthetic'}};
 let attempts=0;
 await runProviderWorker(db,'youtube_music',async claim=>{
  attempts++;assert.equal(claim.id,id);
  await db.catalogPlaylistRefresh.update({where:{id},data:{youtubeState:intent}});
  throw diagnostic('youtube_invalid_created_id');
 },()=> 'youtube_apply');
 assert.equal(attempts,1);
 row=await db.operationalState.findUniqueOrThrow({where:{key}});
 assert.equal((row.payload as any).attempts,2);
 assert.equal((row.payload as any).status,'BLOCKED');assert.equal((row.payload as any).retryAt,null);
 assert.equal((row.payload as any).diagnostic,'playlist_worker_failed stage=youtube_apply reason=youtube_invalid_created_id');
 assert.deepEqual((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id}})).youtubeState,intent);
 assert.equal((await runProviderWorker(db,'youtube_music',async()=>{throw Error('held creation resumed')})).status,'IDLE');
},['youtube_music']));

for(const reason of ['youtube_invalid_readback','youtube_incomplete_readback','youtube_unbounded_readback','youtube_invalid_ordered_readback','youtube_ownership_readback_failed','youtube_final_readback_failed']){
 test(`read-only anomaly ${reason} remains retryable`,()=>fixture(async({id})=>{
  await runProviderWorker(db,'youtube_music',async()=>{throw Object.assign(new Error('readback'),{code:3,stderr:`youtube_reconciliation_required\n${reason}\n`})});
  const row=await db.operationalState.findUniqueOrThrow({where:{key:`playlist-provider:v1:youtube_music:${id}`}});
  assert.equal((row.payload as any).status,'FAILED');assert.ok((row.payload as any).retryAt);
 }));
}
