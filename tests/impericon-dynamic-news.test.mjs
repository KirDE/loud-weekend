import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {impericonFixture,impericonCurrentSource as source,impericonTicketResponse} from './support/impericon-current.ts';
import {IMPERICON_NEWS,discoverImpericonAnnouncements,impericonDynamicNewsUrl} from '../lib/ingestion/adapters/impericon-current.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
const fixture=()=>{
 const e=impericonFixture();
 const listing=e.home.match(/<article-list>[\s\S]*?<\/article-list>/)[0];
 e.news=`<html><head><link rel="canonical" href="${IMPERICON_NEWS.split('?')[0]}"></head><body><div class="dynamic-blog-content">${listing}</div></body></html>`;
 e.home=e.home.replace(listing,readFileSync(new URL('./fixtures/impericon-dynamic-loader.html',import.meta.url),'utf8'));
 return e;
};
const mock=e=>async (url,opts)=>{
 const ticket=impericonTicketResponse(url);if(ticket)return ticket;
 if(url===source.url)return new Response(e.home);
 if(url===IMPERICON_NEWS){assert.equal(opts.redirect,'error');return new Response(e.news);}
 const a=e.articles.find(a=>a.url===url);assert.ok(a);return new Response(a.html);
};
test('real skeleton loader fetches bounded first-party listing, preserving home dates and article checks',async()=>{
 const e=fixture();assert.equal(impericonDynamicNewsUrl(e.home),IMPERICON_NEWS);
 assert.throws(()=>discoverImpericonAnnouncements(e.home,2027),/Incomplete/);
 const r=await fetchSource(source,{fetchImpl:mock(e),maxAttempts:1});assert.equal(r.attempts,6);
 const c=extractFestivalCandidate(await r.response.text(),source,'2026-11-17T17:00:00Z');assert.deepEqual(c.warnings,[]);assert.deepEqual(c.headliners,['Beartooth','Sample Artist']);assert.equal(c.startDate,'2027-06-25');
});
test('later dynamic articles are discovered rather than frozen to current URLs or artist names',async()=>{
 const e=fixture();e.news=e.news.replaceAll('new-headliner','future-headliner');e.articles[0].url=e.articles[0].url.replace('new-headliner','future-headliner');e.articles[0].html=e.articles[0].html.replaceAll('new-headliner','future-headliner').replace('Beartooth','Future Collective');
 const r=await fetchSource(source,{fetchImpl:mock(e),maxAttempts:1});assert.ok(extractFestivalCandidate(await r.response.text(),source,'2026-11-17T17:00:00Z').headliners.includes('Future Collective'));
});
test('unavailable dynamic news remains real failure, never an unchanged empty lineup',async()=>{
 const e=fixture();for(const status of [403,503]){const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async(u,o)=>u===IMPERICON_NEWS?new Response('',{status}):mock(e)(u,o)});assert.equal(r.response.status,status);}
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async(u,o)=>{if(u===IMPERICON_NEWS)throw new Error('network unavailable');return mock(e)(u,o);}}),/network unavailable/);
});
test('wrong canonical, incomplete/ambiguous listing, foreign link and wrong edition fail closed',()=>{
 const e=fixture();for(const news of [e.news.replace('https://www.impericon.com/blogs','https://evil.example/blogs'),e.news.slice(0,-10),e.news.replace('</body>','<article-list></article-list></body>'),e.news.replaceAll('/blogs/festival/','/not-a-blog/'),e.news.replaceAll('2027','2026')])assert.throws(()=>discoverImpericonAnnouncements(e.home,2027,news));
 assert.throws(()=>discoverImpericonAnnouncements(impericonFixture().home,2027,e.news),/Unexpected/);
});
test('page script URLs are not executed or treated as arbitrary fetch instructions',()=>{
 const e=fixture();assert.equal(impericonDynamicNewsUrl(e.home.replace('fetch(`/blogs','fetch(`https://evil.example/blogs')),undefined);
});

test('dynamic network failures count homepage attempts plus exhausted listing retries',async()=>{
 const e=fixture();let calls=0;
 await assert.rejects(fetchSource(source,{maxAttempts:3,sleep:async()=>{},fetchImpl:async(u,o)=>{calls++;if(u===IMPERICON_NEWS)throw new Error('network unavailable');return mock(e)(u,o);}}),error=>{assert.equal(calls,4);assert.equal(error.attempts,4);return true;});
});

test('article failures include homepage, dynamic listing, earlier articles and alias redirects',async()=>{
 for(const dynamic of [true,false])for(const articleIndex of [0,1])for(const redirect of [false,true]){
  const e=dynamic?fixture():impericonFixture();let calls=0;
  const target=e.articles[articleIndex].url,alias=target.replace('/festival/','/magazine/');
  const f=async(u,o)=>{calls++;if(u===target){if(redirect)return new Response('',{status:302,headers:{location:alias}});throw new Error('article unavailable');}if(u===alias)throw new Error('article unavailable');return mock(e)(u,o);};
  const expected=1+Number(dynamic)+articleIndex+Number(redirect)+3;
  await assert.rejects(fetchSource(source,{maxAttempts:3,sleep:async()=>{},fetchImpl:f}),error=>{assert.equal(calls,expected);assert.equal(error.attempts,expected);return true;});
 }
});
