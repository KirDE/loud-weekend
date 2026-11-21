import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db.ts';
import { inspectSource, claimAgentIssue, resolveAgentIssue } from '../lib/ingestion/agent-issues.ts';
import { publishAgentFestivalResolution } from '../lib/catalog/publication.ts';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const festivalIds: string[] = [];
test.after(async () => {
  await db.festival.deleteMany({where:{id:{in:festivalIds}}});
  await db.$disconnect();
});
async function shell(slug = `first-lineup-${randomUUID()}`) {
  const festival = await db.festival.upsert({where:{slug},update:{},create:{slug, name:'Initial roster test', country:'Poland', countryCode:'PL', city:'Warsaw', officialUrl:'https://festival.example.test/', genres:[]}});
  festivalIds.push(festival.id);
  return db.festivalEdition.create({data:{festivalId:festival.id,year:2027,status:'TBA',ticketStatus:'UNKNOWN',recordState:'CURRENT',completeness:'TBA',sourceUpdatedAt:new Date()},include:{festival:true}});
}
function input(edition: Awaited<ReturnType<typeof shell>>) {
  return {editionId:edition.id,festivalSlug:edition.festival.slug,sourceId:`reviewed:${randomUUID()}`,reason:'Verified official first roster',facts:{headliners:[] as string[],lineup:['First Roster Artist'],status:'partial' as 'partial'|'tba'},observedAt:new Date(),evidence:['headliners','lineup','status'].map(field=>({field,url:'https://festival.example.test/',checkedAt:new Date().toISOString(),contentHash:'a'.repeat(64),excerpt:'Verified official roster'}))};
}
const publish = (value: ReturnType<typeof input>) => db.$transaction(tx=>publishAgentFestivalResolution(tx,value),{isolationLevel:'Serializable'});
test('first reviewed lineup creates one native job; replays and later updates do not duplicate it',async()=>{
  const edition=await shell(), value=input(edition);
  const publication=await publish(value);
  assert.equal(publication?.playlistRefreshRequested,true);
  assert.equal((publication?.evidence as any).providerPolicy,'initial-lineup-generation');
  const queued=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{publicationId:publication!.id}});
  assert.equal(queued.status,'PENDING');
  assert.equal(queued.attempts,0);
  assert.equal((await publish(value))?.id,publication!.id);
  assert.equal(await publish({...value,sourceId:`reviewed:${randomUUID()}`}),null);
  assert.equal(await db.catalogPlaylistRefresh.count({where:{festivalSlug:edition.festival.slug}}),1);
  const later=await publish({...value,sourceId:`reviewed:${randomUUID()}`,facts:{...value.facts,lineup:['First Roster Artist','Second Roster Artist']}});
  assert.equal(later?.playlistRefreshRequested,false);
});
for(const guard of ['binding','previous-publication','cancelled-roster','tba','full-rewind'] as const) {
  test(`initial generation does not bypass ${guard}`,async()=>{
    const edition=await shell(guard==='full-rewind'?'full-rewind':undefined),value=input(edition);
    if(guard==='binding') await db.festivalPlaylist.create({data:{editionId:edition.id,provider:'spotify',url:`https://open.spotify.com/playlist/${randomUUID()}`}});
    if(guard==='previous-publication') await db.catalogPublication.create({data:{source:'ADMIN',sourceId:randomUUID(),festivalSlug:edition.festival.slug,editionYear:2027,actorLabel:'test',fields:['lineup'],lineupChanged:true}});
    if(guard==='cancelled-roster') {
      const artist=await db.artist.create({data:{slug:randomUUID(),name:'Cancelled Artist',aliases:[],genres:[],identityState:'UNRESOLVED',topTracks:[],recentSetlists:[],freshness:{}}});
      await db.lineupEntry.create({data:{editionId:edition.id,artistId:artist.id,billing:'LINEUP',position:0,status:'CANCELLED'}});
    }
    if(guard==='tba') value.facts.status='tba';
    const publication=await publish(value);
    assert.equal(publication?.playlistRefreshRequested,false);
    assert.equal(await db.catalogPlaylistRefresh.count({where:{festivalSlug:edition.festival.slug}}),0);
  });
}
test('queue insertion failure rolls back roster, provenance and publication',async()=>{
  const edition=await shell(),value=input(edition);
  await assert.rejects(db.$transaction(async tx=>{
    const failing=Object.create(tx);
    Object.defineProperty(failing,'catalogPlaylistRefresh',{value:{create:async()=>{throw new Error('injected queue failure')}}});
    return publishAgentFestivalResolution(failing,value);
  }),/injected queue failure/);
  assert.equal(await db.lineupEntry.count({where:{editionId:edition.id}}),0);
  assert.equal(await db.editionProvenance.count({where:{editionId:edition.id}}),0);
  assert.equal(await db.catalogPublication.count({where:{sourceId:value.sourceId}}),0);
  assert.equal((await db.festivalEdition.findUniqueOrThrow({where:{id:edition.id}})).status,'TBA');
});

test('protected source apply persists truthful provider receipt and audit, replay stays once-only',async()=>{
  const edition=await shell(),value=input(edition);
  const source=await db.festivalSource.create({data:{festivalId:edition.festivalId,festivalSlug:edition.festival.slug,editionId:edition.id,editionYear:2027,url:'https://festival.example.test/',strategies:['manual_review'],parserKey:'manual_review',refreshPolicy:'weekly',manualReviewReason:'First official roster requires review'}});
  const issue=await inspectSource(db,source.id);
  assert.ok(issue);
  const claim=await claimAgentIssue(db,source.id,issue.issueId);
  const request={...claim,decision:{action:'apply',reason:value.reason,facts:value.facts,evidence:value.evidence}};
  const receipt=await resolveAgentIssue(db,request);
  assert.equal(receipt.providerJobs,1);
  assert.deepEqual(await resolveAgentIssue(db,request),receipt);
  assert.equal(await db.catalogPlaylistRefresh.count({where:{publicationId:receipt.publicationId!}}),1);
  const audit=await db.adminAuditEntry.findFirstOrThrow({where:{action:'ingestion.agent.apply',resourceKey:edition.festival.slug}});
  assert.equal((audit.metadata as any).providerPolicy,'initial-lineup-generation');
  assert.equal((audit.afterValue as any).providerJobs,1);
});
