import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {impericonFixture,impericonCurrentSource as source} from './support/impericon-current.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const html=readFileSync(new URL('./fixtures/impericon-counted-wave.html',import.meta.url),'utf8');
const url=html.match(/rel="canonical" href="([^"]+)"/)[1];
const expected=['The Devil Wears Prada','Comeback Kid','Holding Absence','Walls Of Jericho','Elwood Stray',"Humanity's Last Breath",'Dragged Under','Gideon','Half Me','Sun Eater'];
function extract(body=html){const e=impericonFixture();e.articles=[{url,html:body}];e.home=e.home.replace(/<article-list>[\s\S]*?<\/article-list>/,`<article-list><a href="${url}">Impericon Festival 2027: New Band Wave!</a></article-list>`);return extractFestivalCandidate(JSON.stringify(e),source,'2026-11-09T15:00:00Z');}
test('actual counted day lists and headlined-by recap parse without shop/ticket names',()=>{
 const c=extract();assert.deepEqual(c.lineup,expected);assert.deepEqual(c.headliners,['Lorna Shore','Beartooth']);assert.deepEqual(c.warnings,[]);
 const current={slug:'impericon',editionYear:2027,status:'partial',startDate:'2027-06-25',endDate:'2027-06-26',headliners:['Lorna Shore','Beartooth'],lineup:['Preserved Support']};
 const r=evaluateCandidate(current,c);assert.ok(!r.changes.some(c=>c.kind.endsWith('_removed')));assert.deepEqual(r.changes.filter(c=>c.kind==='artist_added').map(c=>c.after),expected);
 const replay=evaluateCandidate({...current,lineup:['Preserved Support',...expected]},c);assert.deepEqual(replay.changes,[]);
});
test('later count and artist changes are dynamic; no frozen current wave',()=>{
 const c=extract(html.replace('following 10 acts','following 11 acts').replace('</ul>','<li><p><span>Future Ensemble</span></p></li></ul>').replaceAll('Comeback Kid','Later Collective'));
 assert.deepEqual(c.lineup,[expected[0],'Later Collective',...expected.slice(2,6),'Future Ensemble',...expected.slice(6)]);
});
test('incomplete, wrong-edition, cancelled, non-day and non-artist lists fail closed',()=>{
 for(const bad of [html.replace('following 10 acts','following 11 acts'),html.replace('Friday:','Merchandise:'),html.replace('Sun Eater','Sun Eater not performing'),html.replace('Sun Eater','Weekend Tickets'),html.replace('Festival 2027</strong>','Festival 2026</strong>'),html.replace('<span>Sun Eater</span>','<a href="https://evil.example/collections/sun-eater">Sun Eater</a>'),html.replace('</ul>',''),html.replace('Sun Eater', 'Comeback Kid')]){
  const c=extract(bad);assert.equal(c.lineup,undefined);assert.match(c.warnings.join(),/no trustworthy/);
 }
});

test('official collection links inside counted-list paragraphs are handled once',()=>{
 const linked=html.replace('<span>Sun Eater</span>','<a href="https://www.impericon.com/collections/sun-eater"><strong>Sun Eater</strong></a>');
 const c=extract(linked);assert.deepEqual(c.warnings,[]);assert.deepEqual(c.lineup,expected);
 const unknown=extract(linked.replace('</ul>','</ul><p><a href="/collections/unannounced">Unannounced Act</a></p>'));
 assert.equal(unknown.lineup,undefined);assert.match(unknown.warnings.join(),/no trustworthy/);
});
