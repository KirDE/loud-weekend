import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const html=readFileSync(new URL('./fixtures/official-markup/area53-full.html',import.meta.url),'utf8');
const source={festivalSlug:'area53',url:'https://area53festival.at/de/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'daily'};
const parse=(h=html,s={})=>extractFestivalCandidate(h,{...source,...s},'2026-11-22T19:00:00Z');
const c=parse();
const current={slug:'area53',editionYear:2027,city:'Leoben',status:'tba',ticketStatus:'unknown',headliners:[],lineup:[]};
test('full unmodified homepage extracts 14 current edition headings, not stale image alt, gallery or contest',()=>{
 assert.equal(c.lineup.length,14);assert.equal(c.lineup[0],'Edguy');assert.ok(c.lineup.includes('Gutalax'));assert.ok(!c.lineup.includes('Guatalax'));assert.ok(!c.lineup.includes('In Flames'));assert.ok(!c.lineup.includes('EMBERS COLLIDE'));assert.equal(c.headliners,undefined);assert.equal(c.startDate,undefined);assert.equal(c.status,'partial');assert.deepEqual(c.warnings,[]);
});
test('wrong edition, origin, mixed year, missing closing boundary, missing heading and duplicates fail closed',()=>{
 for(const [h,s] of [[html,{editionYear:2028}],[html,{url:'https://evil.test/'}],[html.replace('/images/2027/Lineup%20Update%202/edguy.jpg','/images/2026/old.jpg'),{}],[html.split('<div id="news"')[0],{}],[html.replace('>Edguy</h2>','></h2>'),{}],[html.replace('>Edguy</h2>','>HammerFall</h2>'),{}]])assert.equal(parse(h,s).lineup,undefined);
});
test('review is required for every addition; announcement replay preserves prior artists and billing',()=>{
 const r=evaluateCandidate(current,c,[]);assert.equal(r.publishable,false);assert.ok(r.changes.filter(x=>x.kind==='artist_added').every(x=>x.reviewRequired));assert.equal(r.changes.filter(x=>x.kind==='artist_added').length,14);
 const saved={...current,status:'partial',ticketsUrl:c.ticketsUrl,headliners:[c.lineup[0]],lineup:[...c.lineup.slice(1),'Saved Artist']};
 const replay=evaluateCandidate(saved,c,[]);assert.deepEqual(replay.changes,[]);assert.deepEqual(replay.reviewReasons,[]);
 const next=parse(html.replace('>Edguy</h2>','>New Artist</h2>'));const diff=evaluateCandidate(saved,next,[]);assert.ok(diff.changes.some(x=>x.after==='New Artist'&&x.reviewRequired));assert.ok(!diff.changes.some(x=>x.kind==='artist_removed'));
});
test('admin replacement cannot bypass protected additive publication',async()=>{
 const {assertAdminArtistReviewAllowed}=await import('../lib/catalog/admin-artist-review.ts');
 for(const field of ['lineup','headliners'])assert.throws(()=>assertAdminArtistReviewAllowed('area53',[field]),/protected ingestion review/);
});
test('fetch rejects redirects and overrides but preserves actual HTTP failures',async()=>{
 const {fetchSource}=await import('../lib/ingestion/fetch.ts');
 const reply=(url,status=200)=>{const r=new Response(html,{status});Object.defineProperty(r,'url',{value:url});return r;};
 for(const url of ['https://evil.test/','https://area53festival.at/archive',''])await assert.rejects(fetchSource(source,{fetchImpl:async()=>reply(url),maxAttempts:1}),/trusted identity/);
 for(const extra of [{fetchUrl:'https://evil.test/'},{followLinkPattern:'.*'}])await assert.rejects(fetchSource({...source,...extra},{fetchImpl:async()=>reply(source.url),maxAttempts:1}),/trusted identity/);
 assert.equal((await fetchSource(source,{fetchImpl:async()=>reply(source.url),maxAttempts:1})).response.status,200);
 assert.equal((await fetchSource(source,{fetchImpl:async()=>reply(source.url,503),maxAttempts:1})).response.status,503);
});
