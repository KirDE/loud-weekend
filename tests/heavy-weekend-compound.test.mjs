import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{extractFestivalCandidate}from'../lib/ingestion/extract.ts';import{evaluateCandidate}from'../lib/ingestion/policy.ts';
const saved=JSON.parse(readFileSync(new URL('./fixtures/official-markup/heavy-weekend-reviewed.json',import.meta.url),'utf8'));
const base=JSON.parse(readFileSync(new URL('./fixtures/official-markup/heavy-weekend-linked-2027.json',import.meta.url),'utf8'));
const detail=readFileSync(new URL('./fixtures/official-markup/heavy-compound-slash.html',import.meta.url),'utf8');
const source={festivalSlug:'heavy-weekend',url:'https://www.heavyweekend.live/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'weekly'};
const parse=(html=detail)=>{const e=structuredClone(base);e.documents.find(d=>d.url.endsWith('/slash')).html=html;return extractFestivalCandidate(JSON.stringify(e),source,'2026-11-17T19:31:00Z');};
test('official first-paragraph self-identification expands shortened billing without adding standalone Slash',()=>{
 const c=parse();assert.ok(c.lineup.includes('SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS'));assert.ok(!c.lineup.includes('SLASH'));assert.deepEqual(c.warnings,[]);
 const r=evaluateCandidate(saved,c);assert.ok(!r.changes.some(d=>/slash/i.test(d.after??'')));assert.ok(!r.changes.some(d=>d.kind.endsWith('_removed')));assert.equal(r.publishable,false);
 assert.ok(r.reviewReasons.includes('Agent review required before lineup-triggered provider activity'));
});
test('expansion is based on the current artist identity and explicit credit, not a frozen name list',()=>{
 const c=parse(detail.replaceAll('SLASH','Future Artist').replaceAll('MYLES KENNEDY AND THE CONSPIRATORS','New Collaborators').replace(' FT ',' FEAT. '));assert.ok(c.lineup.includes('Future Artist featuring New Collaborators'));
});
test('history, different artist mentions, hidden text and later paragraphs do not change billing',()=>{
 for(const html of [detail.replace('</strong> est','</strong> était'),detail.replace('<strong>SLASH FT','<strong>Other Artist FT'),detail.replace('<strong>SLASH FT','<strong hidden>SLASH FT'),detail.replace('<p>Avec','<p>Biography introduction.</p><p>Avec'),detail.replace('w-richtext','unrelated')])assert.ok(parse(html).lineup.includes('SLASH'));
});
test('wrong edition and conflicting primary self-identifications fail closed',()=>{
 assert.deepEqual(parse(detail.replace('2027','2026')).evidence,[]);
 const conflicting=detail+detail.slice(detail.indexOf('<div')).replace('MYLES KENNEDY','Another Singer');assert.deepEqual(parse(conflicting).evidence,[]);
});

test('numeric HTML entities in current collaboration credits decode before name validation',()=>{
 for(const encoded of ['O&#x27;Brother','O&#39;Brother','O&#00039;Brother']){
  const c=parse(detail.replaceAll('MYLES KENNEDY AND THE CONSPIRATORS',encoded));assert.ok(c.lineup.includes("SLASH featuring O'Brother"));assert.deepEqual(c.warnings,[]);
 }
});
test('equivalent responsive credits ignore casing while retaining the first official spelling',()=>{
 const repeated=detail+detail.slice(detail.indexOf('<div')).replace('MYLES KENNEDY AND THE CONSPIRATORS','Myles Kennedy And The Conspirators');
 assert.ok(parse(repeated).lineup.includes('SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS'));assert.deepEqual(parse(repeated).warnings,[]);
});
test('present-tense release and historical project statements are not current performing billing',()=>{
 const release=(before,after)=>detail.replace(/<p>[\s\S]*?<\/p>/,`<p>${before}<strong>SLASH FT FERGIE</strong>${after}</p>`);
 for(const [before,after] of [['Son ancien single ',' est sorti en 2010.'],['Le titre ',' est disponible sur son ancien album.'],['Son album ',' est une collaboration historique.'],['Son ancien projet ',' est un groupe des années 1990.']])assert.ok(parse(release(before,after)).lineup.includes('SLASH'));
});
