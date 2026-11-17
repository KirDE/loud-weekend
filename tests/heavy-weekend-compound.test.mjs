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

test('labeled homepage cards still fetch and prefer the verified full detail identity',async()=>{
 const {fetchSource}=await import('../lib/ingestion/fetch.ts');
 const e=structuredClone(base);e.documents.find(d=>d.url.endsWith('/slash')).html=detail;
 e.home=e.home.replace(/(href="\/line-up\/slash"[^>]*>[\s\S]*?alt=")"/,'$1SLASH"');assert.ok(e.home.includes('alt="SLASH"'));
 const calls=[];const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{calls.push(url);return new Response(url===source.url?e.home:e.documents.find(d=>d.url===url).html);}});
 const c=extractFestivalCandidate(await r.response.text(),source,'2026-11-17T20:00:00Z');assert.ok(c.lineup.includes('SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS'));assert.ok(!c.lineup.includes('SLASH'));assert.ok(calls.includes(source.url+'line-up/slash'));
});
test('unrelated or archived rich-text blocks cannot supply or conflict with primary billing',()=>{
 const related='<div class="w-richtext"><p><strong>SLASH FT FERGIE</strong> est un duo.</p></div>';
 assert.ok(parse(detail+related).lineup.includes('SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS'));
 assert.ok(parse(related+detail).lineup.includes('SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS'));
 assert.ok(parse(detail.replace('rich-text-block-7','old-biography')+related).lineup.includes('SLASH'));
});

test('labeled cards cannot override stale or mismatching detail identities and remain bounded',async()=>{
 const {heavyMissingArtistUrls}=await import('../lib/ingestion/adapters/heavy-weekend.ts');
 for(const [label,html] of [['Other Act',detail],['SLASH',detail.replace('2027','2026')]]){
  const e=structuredClone(base);e.home=e.home.replace(/(href="\/line-up\/slash"[^>]*>[\s\S]*?alt=")"/,'$1'+label+'"');e.documents.find(d=>d.url.endsWith('/slash')).html=html;assert.deepEqual(extractFestivalCandidate(JSON.stringify(e),source,'2026-11-17T20:00:00Z').evidence,[]);
 }
 assert.throws(()=>heavyMissingArtistUrls(Array.from({length:21},(_,i)=>`<a href="/line-up/act-${i}"><img alt="Labeled Act ${i}"></a>`).join(''),true),/limit/);
});

test('detail transport failures retain preceding homepage and detail request attempts',async()=>{
 const {fetchSource}=await import('../lib/ingestion/fetch.ts');let calls=0;
 await assert.rejects(fetchSource(source,{maxAttempts:3,sleep:async()=>{},fetchImpl:async url=>{calls++;if(url===source.url)return new Response(base.home);if(url===base.documents[1].url)throw new Error('detail unavailable');return new Response(base.documents.find(d=>d.url===url).html);}}),error=>{assert.equal(calls,5);assert.equal(error.attempts,5);return true;});
});

test('historical introductory clauses do not override explicit current group identity',()=>{
 for(const intro of ['Après son ancien album, ','Après son ancien album ','Depuis son ancien projet, ','Après un ancien single, puis plusieurs tournées, ']){
  const html=detail.replace(/<p>[\s\S]*?<\/p>/,`<p>${intro}<strong>SLASH FT MYLES KENNEDY AND THE CONSPIRATORS</strong> est un groupe de rock.</p>`);assert.ok(parse(html).lineup.includes('SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS'));
 }
});

test('ordinary current group and project subjects retain explicit compound billing',()=>{
 for(const subject of ['Le groupe ','Son groupe ','Le projet ','Ce projet ']){
  const html=detail.replace(/<p>[\s\S]*?<\/p>/,`<p>${subject}<strong>SLASH FT MYLES KENNEDY AND THE CONSPIRATORS</strong> est une collaboration durable.</p>`);assert.ok(parse(html).lineup.includes('SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS'));
 }
 for(const subject of ['Son ancien groupe ','Le projet historique ','Son ancien projet ']){
  const html=detail.replace(/<p>[\s\S]*?<\/p>/,`<p>${subject}<strong>SLASH FT FERGIE</strong> est un duo de rock.</p>`);assert.ok(parse(html).lineup.includes('SLASH'));
 }
});
