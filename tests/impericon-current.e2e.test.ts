import { createPrismaClient } from '../lib/prisma-client.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSeed} from './support/catalog.ts';
import {seedCatalog} from './support/seed-catalog.ts';
import {requireLocalDisposableDatabase} from './support/disposable-db.ts';
import {impericonFixture,impericonCurrentSource as source,impericonTicketFixture,impericonTicketUrl} from './support/impericon-current.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {DatabaseCatalogRepository} from '../lib/catalog/repository.ts';
import {createIngestionRun,persistAttempt} from '../lib/ingestion/repository.ts';
import {publishIngestionResult} from '../lib/catalog/publication.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db=createPrismaClient();
test.beforeEach(async()=>{
 const festival={...catalogSeed.festivals[0],slug:'impericon',name:'Synthetic Impericon',officialUrl:source.url,ticketStatus:'unknown' as const,ticketsUrl:source.url,startDate:'2027-06-25',endDate:'2027-06-26',lineup:['Support One']};
 await seedCatalog(db,{festivals:[festival],editions:catalogSeed.editions.map(e=>({...e,slug:'impericon',...(e.recordState==='current'?festival:{})})),
  artists:[...catalogSeed.artists,{...catalogSeed.artists[0],slug:'support-one',name:'Support One'},{...catalogSeed.artists[0],slug:'beartooth',name:'Beartooth'}],playlists:{}});
 await db.festivalEdition.updateMany({where:{festival:{slug:'impericon'},year:2027},data:{status:'PARTIAL',completeness:'PARTIAL'}});
});
test.after(async()=>{await db.festivalSource.deleteMany({where:{festivalSlug:'impericon'}});await db.festival.deleteMany({where:{slug:'impericon'}});await db.$disconnect();});
async function prepare(){
 const current=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;
 const candidate=extractFestivalCandidate(JSON.stringify(impericonFixture()),source,new Date().toISOString());
 const result=evaluateCandidate(current,candidate);assert.deepEqual(result.changes.map(c=>[c.kind,c.after]),[['headliner_added','Beartooth']]);
 const run=await createIngestionRun(db,{trigger:'TEST',sourceCommit:'impericon-current-test',totalSources:1});
 const attempt=await persistAttempt(db,{runId:run.id,festivalSlug:'impericon',requestedUrl:source.url,httpStatus:200,durationMs:1,startedAt:new Date(),endedAt:new Date(),result});
 return{result,attempt};
}
test('persisted current-announcement import adds headliner and queues one playlist refresh, including replay',async()=>{
 const archived=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'impericon'},year:2026},include:{lineup:true}});
 const artist=await db.artist.findUniqueOrThrow({where:{slug:'beartooth'}});
 const jobs=await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}});
 const {result,attempt}=await prepare();
 const publication=await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-current-test'});
 assert.ok(publication);assert.equal(publication.playlistRefreshRequested,true);
 const queued=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{publicationId:publication.id}});
 assert.equal(queued.festivalSlug,'impericon');assert.equal(queued.status,'PENDING');
 assert.equal((publication.evidence as {playlistRefresh?:unknown}).playlistRefresh,undefined);
 const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'impericon'},year:2027},include:{lineup:true}});
 assert.equal(edition.lineup.find(l=>l.artistId===artist.id)?.billing,'HEADLINER');assert.equal(edition.lineup.length,3);assert.equal(edition.status,'PARTIAL');
 assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}})).reviewState,'PUBLISHED');
 assert.deepEqual(await db.festivalEdition.findUniqueOrThrow({where:{id:archived.id},include:{lineup:true}}),archived);
 const replay=await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-current-test'});assert.equal(replay?.id,publication.id);
 assert.equal(await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}}),jobs+1);
 const current=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;
 const unchanged=evaluateCandidate(current,result.candidate);assert.deepEqual(unchanged.changes,[]);assert.deepEqual(unchanged.reviewReasons,[]);
});
test('missing persisted official field evidence rejects and rolls back before any provider activity',async()=>{
 const {result,attempt}=await prepare();
 const candidate=await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}});
 await db.ingestionEvidence.deleteMany({where:{candidateId:candidate.id,field:'headliners'}});
 const jobs=await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}});
 await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-current-test'}),/publication requires matching persisted/);
 assert.equal(await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}}),jobs);
 const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'impericon'},year:2027},include:{lineup:true}});assert.equal(edition.lineup.length,2);
});

async function prepareInventory(){
 const current=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;
 const env={...impericonFixture(),ticketProducts:[{url:impericonTicketUrl,product:JSON.parse(impericonTicketFixture)}]};
 const candidate=extractFestivalCandidate(JSON.stringify(env),source,new Date().toISOString());
 const result=evaluateCandidate(current,candidate);assert.equal(result.publishable,true);assert.deepEqual(result.reviewReasons,[]);
 const run=await createIngestionRun(db,{trigger:'TEST',sourceCommit:'impericon-stock-test',totalSources:1});
 const attempt=await persistAttempt(db,{runId:run.id,festivalSlug:'impericon',requestedUrl:source.url,httpStatus:200,durationMs:1,startedAt:new Date(),endedAt:new Date(),result});
 return {result,attempt};
}
test('actual source product stock and artist addition publish atomically with the existing provider policy',async()=>{
 const {result,attempt}=await prepareInventory();
 assert(result.changes.some(c=>c.field==='ticketStatus'));assert(result.changes.some(c=>c.kind==='headliner_added'));
 const before=await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}});
 const publication=await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-stock-test'});
 assert(publication);assert.equal(publication.playlistRefreshRequested,true);
 const saved=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;
 assert.equal(saved.ticketStatus,'available');assert.equal(saved.ticketsUrl,impericonTicketUrl.slice(0,-3));assert(saved.headliners.includes('Beartooth'));
 assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}})).reviewState,'PUBLISHED');
 assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-stock-test'}))?.id,publication.id);
 assert.equal(await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}}),before+1);
 assert.deepEqual(evaluateCandidate(saved,result.candidate).changes,[]);
});
test('ticket-only inventory changes persist and replay without adding provider work',async()=>{
 const first=await prepare();await publishIngestionResult(db,{attemptId:first.attempt.id,result:first.result,sourceCommit:'impericon-current-test'});
 const {result,attempt}=await prepareInventory();assert(result.changes.every(c=>['ticketStatus','ticketsUrl'].includes(c.field)));
 const before=await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}});
 const publication=await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-stock-test'});
 assert(publication);assert.equal(publication.playlistRefreshRequested,false);
 const saved=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;
 assert.equal(saved.ticketStatus,'available');
 assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-stock-test'}))?.id,publication.id);
 assert.equal(await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}}),before);
});
test('missing, foreign, stale or mismatched persisted inventory evidence rolls back stock and artist changes',async()=>{
 for(const drift of ['persisted-evidence','observed-value','normalized-value','foreign-proof','timestamp']){
  const {result,attempt}=await prepareInventory();
  const candidate=await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}});
  if(drift==='persisted-evidence')await db.ingestionEvidence.deleteMany({where:{candidateId:candidate.id,field:'ticketStatus'}});
  if(drift==='observed-value')await db.ingestionEvidence.updateMany({where:{candidateId:candidate.id,field:'ticketStatus'},data:{observedValue:'sold_out'}});
  if(drift==='normalized-value')await db.ingestionCandidate.update({where:{id:candidate.id},data:{normalized:{...result.candidate,ticketStatus:'sold_out'} as any}});
  if(drift==='foreign-proof')result.candidate.evidence.filter(e=>e.field==='ticketStatus').forEach(e=>e.sourceUrl='https://elsewhere.example/product');
  if(drift==='timestamp')await db.ingestionEvidence.updateMany({where:{candidateId:candidate.id,field:'ticketStatus'},data:{observedAt:new Date('2020-01-01T00:00:00Z')}});
  const before={entries:await db.lineupEntry.count(),jobs:await db.catalogPlaylistRefresh.count(),pub:await db.catalogPublication.count()};
  await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-stock-test'}),/Impericon publication requires matching persisted/);
  assert.deepEqual({entries:await db.lineupEntry.count(),jobs:await db.catalogPlaylistRefresh.count(),pub:await db.catalogPublication.count()},before);
  const saved=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;assert.equal(saved.ticketStatus,'unknown');assert(!saved.headliners.includes('Beartooth'));
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{id:candidate.id}})).reviewState,'PENDING');
 }
});
