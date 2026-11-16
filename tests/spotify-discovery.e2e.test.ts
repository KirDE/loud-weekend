import { createPrismaClient } from '../lib/prisma-client.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
import { discoverSpotifyChunk } from '../lib/catalog/spotify-discovery.ts';
import { claimPlaylistRefresh } from '../lib/catalog/playlist-queue.ts';
import { providerRetryDelay } from '../lib/catalog/playlist-provider-worker.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
test.after(async () => db.$disconnect());
test('discovery scratch resumes exact inputs, rejects lost lease, never stages a partial plan', async () => {
 const slug='discovery-'+randomUUID();
 const f=await db.festival.create({data:{slug,name:'Synthetic',country:'Test',countryCode:'DE',genres:[],officialUrl:'https://example.test/',editions:{create:{year:2027,status:'PARTIAL',ticketStatus:'UNKNOWN',recordState:'CURRENT',completeness:'PARTIAL',sourceUpdatedAt:new Date()}}}});
 const p=await db.catalogPublication.create({data:{source:'ADMIN',sourceId:slug,festivalSlug:slug,editionYear:2027,actorLabel:'test',fields:['lineup'],lineupChanged:true}});
 const j=await db.catalogPlaylistRefresh.create({data:{publicationId:p.id,festivalSlug:slug,requestedAt:new Date('1900-01-01')}});
 const key=`playlist-discovery:spotify:v1:${j.id}`;
 try {
  const {claim}=await claimPlaylistRefresh(db,{owner:randomUUID(),ttlMs:120000}); assert.ok(claim); assert.equal(claim.id,j.id);
  const checkpoint={followers:{Alpha:1},report:[],uris:[],songKeys:[]};
  await assert.rejects(discoverSpotifyChunk(db,claim,{season:2027},async()=>({discoveryCheckpoint:checkpoint})),{code:'SPOTIFY_DISCOVERY_CHECKPOINT'});
  assert.equal((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:j.id}})).desiredPlan,null);
  const complete={track_uris:['synthetic'],report:[]};
  assert.deepEqual(await discoverSpotifyChunk(db,claim,{season:2027},async input=>{assert.deepEqual((input as any).discoveryCheckpoint,checkpoint);return complete}),complete);
  await discoverSpotifyChunk(db,claim,{season:2028},async input=>{assert.equal((input as any).discoveryCheckpoint,undefined);return complete});
  await db.catalogPlaylistRefresh.update({where:{id:j.id},data:{leaseExpiresAt:new Date('1900-01-01')}});
  await assert.rejects(discoverSpotifyChunk(db,claim,{season:2027},async()=>{throw Error('must not run')}));
  assert.deepEqual((await db.operationalState.findUniqueOrThrow({where:{key}})).payload, {fingerprint:(await import('node:crypto')).createHash('sha256').update(JSON.stringify({season:2027})).digest('hex'),checkpoint});
  assert.equal(providerRetryDelay(100,{code:'SPOTIFY_DISCOVERY_CHECKPOINT'}),60000);
  assert.equal(providerRetryDelay(100,{playlistRpcTimedOut:true}),86400000);
 } finally {
  await db.operationalState.deleteMany({where:{key}});
  await db.catalogPlaylistRefresh.updateMany({where:{id:j.id},data:{status:'SUCCEEDED',leaseOwner:null,leaseExpiresAt:null}});
  await db.festival.delete({where:{id:f.id}});
 }
});
