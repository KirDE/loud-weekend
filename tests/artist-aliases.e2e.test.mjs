import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrismaClient } from '../lib/prisma-client.mjs';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
import { seedCatalog } from './support/seed-catalog.ts';
import { catalogSeed } from './support/catalog.ts';
import { addArtistAliases } from '../lib/catalog/artist-alias-repository.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { publishIngestionResult } from '../lib/catalog/publication.ts';
import { createIngestionRun, persistAttempt } from '../lib/ingestion/repository.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db=createPrismaClient();
const other=createPrismaClient();
const input={slug:'sample-artist',aliases:['Alternate Name','別名'],actorLabel:'alias-test',evidence:'https://official.example.test/verified'};
test.before(async()=>{await seedCatalog(db,catalogSeed);await db.artist.deleteMany({where:{slug:'archived-other'}});});
test.after(async()=>{await seedCatalog(db,catalogSeed);await db.artist.deleteMany({where:{slug:'archived-other'}});await other.$disconnect();await db.$disconnect();});
async function persist(value) {
 const run=await createIngestionRun(db,{trigger:'TEST',sourceCommit:'alias-test',totalSources:1});
 return persistAttempt(db,{runId:run.id,festivalSlug:value.festivalSlug,requestedUrl:value.sourceUrl,httpStatus:200,durationMs:1,startedAt:new Date(value.fetchedAt),endedAt:new Date(value.fetchedAt),result:value});
}
function result(name){const fetchedAt=new Date().toISOString();return {schemaVersion:1,festivalSlug:'synthetic-fest',sourceUrl:'https://festival.example.test/',fetchedAt,changes:[{kind:'artist_added',field:'headliners',after:name,reviewRequired:false}],candidate:{schemaVersion:1,festivalSlug:'synthetic-fest',sourceUrl:'https://festival.example.test/',fetchedAt,startDate:'2027-06-10',headliners:[name],warnings:[],observedEditionYears:[2027],evidence:[]},publishable:true,reviewReasons:[]};}
test('verified aliases survive independent client read, audit once and leave facts/providers unchanged',async()=>{
 const before=await db.lineupEntry.findMany({orderBy:{id:'asc'}});const jobs=await db.catalogPlaylistRefresh.count();
 const auditsBefore=await db.adminAuditEntry.count({where:{action:'artist.aliases.add',resourceKey:input.slug}});
 const first=await addArtistAliases(db,input);assert.equal(first.changed,true);
 const stored=await other.artist.findUniqueOrThrow({where:{slug:input.slug}});assert.deepEqual(stored.aliases,input.aliases);
 assert.equal(stored.name,'Sample Artist');assert.equal(stored.id,first.id);
 assert.equal((await addArtistAliases(db,input)).changed,false);
 assert.equal(await db.adminAuditEntry.count({where:{action:'artist.aliases.add',resourceKey:input.slug}}),auditsBefore+1);
 assert.deepEqual(await db.lineupEntry.findMany({orderBy:{id:'asc'}}),before);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 const c=result('Alternate Name').candidate;
 const evaluated=evaluateCandidate(catalogSeed.festivals[0],c,await other.artist.findMany());assert.deepEqual(evaluated.changes,[]);assert.deepEqual(evaluated.reviewReasons,[]);
});
test('collision and invalid input roll back aliases and audit atomically',async()=>{
 await db.artist.create({data:{slug:'archived-other',name:'Other Identity',aliases:['Taken Name'],genres:[],identityState:'UNRESOLVED',topTracks:[],recentSetlists:[],freshness:{}}});
 const before=await db.artist.findUniqueOrThrow({where:{slug:input.slug}});const audits=await db.adminAuditEntry.count();
 for(const alias of ['Other Identity','Taken Name']) await assert.rejects(addArtistAliases(db,{...input,aliases:['Safe Name',alias]}),/collision/);
 await assert.rejects(addArtistAliases(db,{...input,aliases:['']}),/Invalid/);
 await assert.rejects(addArtistAliases(db,{...input,evidence:''}),/evidence/);
 assert.deepEqual((await db.artist.findUniqueOrThrow({where:{slug:input.slug}})).aliases,before.aliases);assert.equal(await db.adminAuditEntry.count(),audits);
});
test('publication through a Unicode alias reuses artist ID, no duplicates or provider jobs',async()=>{
 const count=await db.artist.count();const jobs=await db.catalogPlaylistRefresh.count();const value=result('別名');const attempt=await persist(value);
 const published=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:'alias-test'});
 assert.equal(published,null);assert.equal(await db.artist.count(),count);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 const entries=await db.lineupEntry.findMany({where:{edition:{recordState:'CURRENT',festival:{slug:'synthetic-fest'}}},include:{artist:true}});assert.equal(entries.length,1);assert.equal(entries[0].artist.slug,'sample-artist');
});
test('replacement rosters reject duplicate alias IDs before any lineup writes',async()=>{
 const before=await db.lineupEntry.findMany({orderBy:{id:'asc'}});
 const jobs=await db.catalogPlaylistRefresh.count();const value=result('Alternate Name');
 value.changes=[{field:'headliners',after:['Alternate Name','別名'],reviewRequired:false}];
 const attempt=await persist(value);await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:'alias-test'}),/duplicate alias/);
 assert.deepEqual(await db.lineupEntry.findMany({orderBy:{id:'asc'}}),before);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
});
test('publication refuses alias-driven cross-billing changes and global collisions',async()=>{
 let value=result('Alternate Name');value.changes=[{kind:'artist_added',field:'lineup',after:'Alternate Name',reviewRequired:false}];let attempt=await persist(value);
 await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:'alias-test'}),/Ambiguous billing/);
 await db.artist.update({where:{slug:'archived-other'},data:{aliases:{push:'Alternate Name'}}});
 value=result('Alternate Name');attempt=await persist(value);await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:'alias-test'}),/Ambiguous artist identity/);
});
