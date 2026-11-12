import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
const bundle=JSON.parse(readFileSync(new URL('./fixtures/download-announcement.json',import.meta.url)));
const source={festivalSlug:'download',url:'https://downloadfestival.co.uk/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'daily'};
const parse=(b=bundle,s=source)=>extractFestivalCandidate(JSON.stringify(b),s,'2026-11-12T21:28:00Z');
const saved={slug:'download',editionYear:2027,startDate:'2027-06-09',endDate:'2027-06-13',headliners:[],lineup:[],status:'tba',ticketStatus:'unknown'};
test('real official HTML excerpts produce 100 distinct artists, explicit headliners, partial additive bill',()=>{
 const c=parse();assert.deepEqual(c.headliners,['blink-182','Bring Me The Horizon','Evanescence']);assert.equal(c.lineup.length,97);assert.equal(new Set([...c.headliners,...c.lineup]).size,100);assert.ok(c.lineup.includes('HANABIE.'));assert.equal(c.status,'partial');assert.deepEqual(c.warnings,[]);
 const r=evaluateCandidate(saved,c);assert.equal(r.publishable,true);assert.equal(r.changes.filter(x=>x.field==='lineup'||x.field==='headliners').length,100);
 assert.deepEqual(evaluateCandidate({...saved,headliners:c.headliners,lineup:c.lineup,status:'partial'},c).changes,[]);
});
test('later artists/editions work while missing cards never remove saved acts',()=>{
 const b=structuredClone(bundle);b.artists=b.artists.replace(/<\/nav>\s*$/,'<div class="artist grid-item new"><a href="/artists-a-z/new-act/"><div class="artist-title ">New Act</div></a></div></nav>');assert.ok(parse(b).lineup.includes('New Act'));
 assert.equal(parse(JSON.parse(JSON.stringify(bundle).replaceAll('2027','2028')),{...source,editionYear:2028}).startDate,'2028-06-09');
 const c=parse();const r=evaluateCandidate({...saved,headliners:c.headliners,lineup:[...c.lineup,'Prior Act'],status:'partial'},c);assert.deepEqual(r.changes,[]);
});
test('wrong edition, incomplete listing, missing billing or untrusted artist links fail closed',()=>{
 for(const mutate of [b=>b.artists=b.artists.replaceAll('2027','2026'),b=>b.artists=b.artists.replaceAll('</nav>',''),b=>b.home=b.home.replace('are your #DLXXIV headliners','are performing'),b=>b.artists=b.artists.replace('https://downloadfestival.co.uk/artists-a-z/blink-182/','https://evil.invalid/artists-a-z/blink-182/'),b=>b.artists=b.artists.replaceAll('>blink-182<','>Other Act<')]){const b=structuredClone(bundle);mutate(b);assert.deepEqual(parse(b).evidence,[]);}
});
test('two-document transport propagates HTTP failures and rejects identity changes',async()=>{
 for(const status of [200,403]){const calls=[];const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async(u,o)=>{calls.push(u);if(u===source.url)return new Response(bundle.home);assert.equal(u,source.url+'artists-a-z/');assert.equal(o.redirect,'error');return new Response(bundle.artists,{status});}});assert.equal(r.response.status,status);assert.equal(calls.length,2);assert.equal(r.attempts,2);if(status===200)assert.equal(parse(JSON.parse(await r.response.text())).lineup.length,97);}
 await assert.rejects(fetchSource({...source,fetchUrl:'https://evil.invalid/'},{fetchImpl:async()=>new Response(bundle.home)}),/identity changed/);
});

test('billing promotions and demotions require review rather than failed publication',()=>{
 const c=parse();
 for(const current of [
  {...saved,lineup:['BLINK-182']},
  {...saved,headliners:[c.lineup[0].toUpperCase()]},
 ]) {
  const r=evaluateCandidate(current,c);
  assert.equal(r.publishable,false);
  assert.ok(r.reviewReasons.includes('Download billing changes require reviewed reclassification'));
 }
});
test('artist-list retries retain homepage and listing attempts on HTTP failure',async()=>{
 let calls=0;
 const r=await fetchSource(source,{maxAttempts:2,baseDelayMs:0,sleep:async()=>{},fetchImpl:async()=>{
  calls++;return calls===1?new Response(bundle.home):new Response('unavailable',{status:503});
 }});
 assert.equal(r.response.status,503);assert.equal(r.attempts,3);assert.equal(calls,3);
});

test('artist-list thrown failures retain homepage attempts and the original error',async()=>{
 let calls=0; const failure=new Error('connection reset');
 await assert.rejects(fetchSource(source,{maxAttempts:2,baseDelayMs:0,sleep:async()=>{},fetchImpl:async()=>{
  calls++;if(calls===1)return new Response(bundle.home);throw failure;
 }}),error=>error===failure && error.attempts===3);
 assert.equal(calls,3);
});

test('complete stored roster with misbilled support requires review even with zero roster diffs',()=>{
 const c=parse();const support=c.lineup[0];
 const r=evaluateCandidate({...saved,status:'partial',headliners:[...c.headliners,support],lineup:c.lineup.filter(n=>n!==support)},c);
 assert.deepEqual(r.changes,[]);assert.equal(r.publishable,false);
 assert.ok(r.reviewReasons.includes('Download billing changes require reviewed reclassification'));
});
test('Download body stream errors preserve all completed request attempts',async()=>{
 for(const failedDocument of ['home','artists']) {
  const failure=new Error('body stream reset');let calls=0;
  const broken=()=>new Response(new ReadableStream({start(controller){controller.error(failure);}}));
  await assert.rejects(fetchSource(source,{maxAttempts:2,baseDelayMs:0,sleep:async()=>{},fetchImpl:async()=>{
   calls++;
   if(failedDocument==='home') return broken();
   if(calls===1)return new Response(bundle.home);
   if(calls===2)return new Response('retry',{status:503});
   return broken();
  }}),error=>error===failure && error.attempts===(failedDocument==='home'?1:3));
  assert.equal(calls,failedDocument==='home'?1:3);
 }
});
