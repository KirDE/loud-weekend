import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runIngestion} from '../lib/ingestion/run.ts';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {validateSource} from '../lib/sources/repository.ts';
import {parserSource} from './support/parser-source.ts';
const fixture=await readFile(new URL('./fixtures/official-markup/firenze-rocks-holding.html',import.meta.url),'utf8');
const source=parserSource('firenze-rocks',{url:'https://www.firenzerocks.it/',refreshPolicy:'weekly'});
const observed='2026-10-10T16:11:00.000Z';
const current={slug:'firenze-rocks',editionYear:2027,name:'Firenze Rocks',city:'Florence',headliners:[],lineup:[],status:'tba',ticketStatus:'unknown'};
function empty(candidate){for(const f of ['startDate','endDate','city','lineup','headliners','status','ticketsUrl','ticketStatus'])assert.equal(candidate[f],undefined);assert.deepEqual(candidate.evidence,[]);}
function quiet(html=fixture,config=source){const c=extractFestivalCandidate(html,config,observed);empty(c);assert.deepEqual(c.warnings,[]);assert.deepEqual(c.observedEditionYears,[]);const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);return c;}
function review(html){const c=extractFestivalCandidate(html,source,observed);empty(c);assert.match(c.warnings.join(' '),/holding page changed/);assert.equal(evaluateCandidate(current,c).publishable,false);}
test('real corrected official holding page is unchanged, registered, weekly and provider-inert',()=>{assert.equal(validateSource(source),'official_markup:firenze-rocks');quiet();});
test('original manual strategy reproduces pointless review and remains inert until protected activation',()=>{const c=extractFestivalCandidate(fixture,{...source,strategies:['manual_review'],manualReviewReason:'official Live Nation shell does not expose a single authoritative festival date range'},observed);empty(c);assert.match(c.warnings[0],/^Manual review only/);});
test('no exact document hash: layout class, runtime version and copyright changes remain quiet',()=>quiet(fixture.replaceAll('li0owl4','new-layout').replace('v136','v200').replace('2025 Firenze','2026 Firenze')));
test('future year also supports unchanged pre-announcement shell, not a hardcoded festival edition',()=>quiet(fixture,{...source,editionYear:2028}));
test('does not clear a previously verified partial bill or tickets',()=>{const c=quiet(),r=evaluateCandidate({...current,status:'partial',lineup:['Previously verified artist'],ticketsUrl:'https://www.firenzerocks.it/tickets',ticketStatus:'available'},c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);});
for(const[name,change]of [
 ['new text/date/artist announcement',h=>h.replace('</main>','<h3>Firenze Rocks 2027: 15 June, New Artist announced</h3></main>')],
 ['image-only poster',h=>h.replace('</main>','<img src="/poster-2027.jpg" alt=""></main>')],
 ['CSS image-only poster',h=>h.replace('</main>','<div style="background-image:url(/poster.jpg)"></div></main>')],
 ['tickets',h=>h.replace('</main>','<a href="/tickets">Acquista</a></main>')],
 ['changed video announcement',h=>h.replace('video-sito-mob.mp4','announcement-2027.mp4')],
 ['replaced video asset',h=>h.replace('k4tcpivz','new-announcement')],
 ['metadata announcement',h=>h.replace('name="description" content="Home | Firenze Rocks"','name="description" content="Firenze Rocks 2027 bill announced"')],
 ['new edition logo',h=>h.replace('firenze-rocks-2026_primary','firenze-rocks-2027_primary')],
 ['event JSON-LD',h=>h+'<script type="application/ld+json">{"@type":"MusicEvent","name":"Artist","startDate":"2027-06-15"}</script>'],
 ['template drift',h=>h.replaceAll('/holdingPage/','/festivalHome/')],
 ['incomplete/error page',()=>'<title>Home | Firenze Rocks</title><h1>Forbidden</h1>'],
 ['empty main',h=>h.replace(/<main[\s\S]*<\/main>/,'<main></main>')],
 ['unknown widget',h=>h.replace('</main>','<iframe src="/announcement"></iframe></main>')],
 ['announcement hidden in legal footer',h=>h.replace('Copyright © 2025','<img src="/poster.jpg">Copyright © 2025')],
 ['poster masquerading as social icon',h=>h.replace('width="69"','width="1024"')],
 ['new heading beyond shell',h=>h.replace('SEGUICI','LINEUP 2027')],
])test(`new official evidence returns to review: ${name}`,()=>review(change(fixture)));

test('successful no-announcement checks reset health and remain unchanged, not review/failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'firenze-health-'));
 try{const stateFile=join(dir,'state.json');await writeFile(stateFile,JSON.stringify({schemaVersion:1,sources:{'firenze-rocks':{consecutiveFailures:3,lastAttemptAt:'2026-10-01T00:00:00Z',lastSuccessfulExtraction:'2026-09-01T00:00:00Z'}}}));
 const summary=await runIngestion({sources:[source],festivals:[current],outputDirectory:join(dir,'results'),stateFile,failureThreshold:3,now:()=>new Date(observed),fetchOptions:{fetchImpl:async()=>new Response(fixture,{status:200})}});
 assert.equal(summary.reviewRequired,0);assert.equal(summary.fetchErrors,0);assert.equal(summary.changed,0);assert.equal(summary.results[0].status,'unchanged');
 const health=JSON.parse(await readFile(stateFile,'utf8')).sources['firenze-rocks'];assert.equal(health.consecutiveFailures,0);assert.equal(health.lastSuccessfulCheck,observed);assert.equal(health.lastSuccessfulExtraction,'2026-09-01T00:00:00Z');
 }finally{await rm(dir,{recursive:true,force:true});}
});

const svgFixture=await readFile(new URL('./fixtures/official-markup/firenze-rocks-holding-svg.html',import.meta.url),'utf8');
test('actual November generic SVG logo holding shell is quiet and provider-inert',()=>{quiet(svgFixture);quiet(svgFixture,{...source,editionYear:2028});});
test('generic brand-logo exception rejects foreign/credentialed/query/edition/poster logo variants',()=>{
 for(const bad of ['https://evil.invalid/networksites/a/logo.svg','https://user@networksites.livenationinternational.com/networksites/a/logo.svg','https://networksites.livenationinternational.com/networksites/a/logo.svg?year=2027','https://networksites.livenationinternational.com/networksites/a/poster.svg','https://networksites.livenationinternational.com/networksites/a/logo-2027.svg']){
  review(svgFixture.replaceAll('https://networksites.livenationinternational.com/networksites/u4lp0w3n/logo.svg',bad));
 }
});
test('generic SVG route cannot hide a responsive announcement image',()=>review(svgFixture.replaceAll('src="https://networksites.livenationinternational.com/networksites/u4lp0w3n/logo.svg"','src="https://networksites.livenationinternational.com/networksites/u4lp0w3n/logo.svg" srcset="/announcement-2027.png 2x"')));
test('real SVG shell still escalates new facts, media, ticket and metadata announcements',()=>{
 for(const h of [svgFixture.replace('</main>','<h3>2027 LINEUP ANNOUNCED</h3></main>'),svgFixture.replace('</main>','<img src="/poster.jpg"></main>'),svgFixture.replace('</main>','<a href="/tickets">Tickets</a></main>'),svgFixture.replace('video-sito-mob.mp4','announcement.mp4'),svgFixture.replace('name="description" content="Home | Firenze Rocks"','name="description" content="2027 lineup announced"')])review(h);
 const c=quiet(svgFixture);const r=evaluateCandidate({...current,status:'confirmed',lineup:['Previously Verified'],ticketsUrl:'https://example.invalid/saved'},c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});

test('unknown SVG asset cannot silently hide a header-only edition announcement',()=>{
 for(const id of ['laterasset','announcement2027']) review(svgFixture.replaceAll('/u4lp0w3n/',`/${id}/`));
 // A single changed responsive header logo must also trigger review.
 review(svgFixture.replace('/u4lp0w3n/','/newedition/'));
});

for(const [name,base] of [['SVG',svgFixture],['legacy PNG',fixture]]) {
 test(`responsive picture source cannot hide a header-only announcement (${name})`,()=>{
  for(const art of ['/lineup-2027.svg','/future-edition.webp']) {
   const html=base.replace(/<img\b[^>]*>/i,img=>`<picture><source media="(min-width: 800px)" srcset="${art}">${img}</picture>`);
   review(html);
  }
 });
}

test('unquoted SVG img srcset is not ignored',()=>review(svgFixture.replace(/<img\b/i,'<img srcset=/announcement-2027.svg')));

for (const [name, base] of [['SVG', svgFixture], ['legacy PNG', fixture]]) {
 test(`header CSS artwork cannot hide an announcement (${name})`, () => {
  for (const style of ['background-image:url(/lineup-2027.jpg)', 'content:url(/lineup-2027.svg)']) {
   review(base.replace('<header', `<header style="${style}"`));
   review(base.replace(/<img\b/i, `<img style="${style}"`));
   review(base.replace(/<header\b[^>]*>/i, tag => `${tag}<div style='${style}'></div>`));
   review(base.replace(/<header\b[^>]*>/i, tag => `${tag}<div style=${style}></div>`));
  }
 });
 test(`direct header media cannot hide an announcement (${name})`, () => {
  for (const media of ['<video src="/lineup-2027.mp4"></video>', '<iframe src="/announcement"></iframe>', '<svg><image href="/lineup-2027.svg"/></svg>', '<object data="/lineup-2027.svg"></object>', '<embed src="/lineup-2027.svg">', '<canvas></canvas>', '<style>header{background-image:url(/lineup-2027.jpg)}</style>']) {
   review(base.replace('</header>', `${media}</header>`));
  }
 });
}

test('only the verified language globe vector is quiet, not added or changed SVG artwork', () => {
 for (const base of [svgFixture, fixture]) {
  review(base.replace('</header>', '<svg><path d="M0 0H300V200H0Z"></path></svg></header>'));
  review(base.replace('M11.99 2C6.47', 'M99 2C6.47'));
  review(base.replace('<path ', '<rect width="100" height="100"/><path '));
 }
});

test('prefixed attributes cannot spoof header src, alt or SVG geometry', () => {
  const pinned='https://networksites.livenationinternational.com/networksites/u4lp0w3n/logo.svg';
  for (const prefix of ['data-', 'x-', ':']) {
   review(svgFixture.replaceAll(`src="${pinned}"`, `${prefix}src="${pinned}" src="/firenze-rocks-2027-poster.svg"`));
   review(svgFixture.replaceAll('alt="Site logo - www.firenzerocks.it - go to homepage"', `${prefix}alt="Site logo - www.firenzerocks.it - go to homepage" alt="Edition announcement"`));
   review(svgFixture.replace('viewBox="0 0 24 24"', `${prefix}viewBox="0 0 24 24" viewBox="0 0 300 200"`));
   review(svgFixture.replace(/<path d="([^"]+)"/, (_, d) => `<path ${prefix}d="${d}" d="M0 0H300V200H0Z"`));
  }
 });

test('quoted attribute values cannot impersonate a pinned logo src', () => {
 const pinned='https://networksites.livenationinternational.com/networksites/u4lp0w3n/logo.svg';
 review(svgFixture.replaceAll(`src="${pinned}"`, `title=' src="${pinned}" ' src="/edition-2027.svg"`));
 quiet(svgFixture.replaceAll(`src="${pinned}"`, `data-src="/unused.svg" src="${pinned}"`));
 quiet(svgFixture.replaceAll(`src="${pinned}"`, `src=${pinned} `));
});

test('only known header elements are accepted; image inputs and unknown widgets trigger review', () => {
 for (const base of [svgFixture, fixture]) {
  for (const markup of ['<input type="image" src="/lineup-2027.jpg">', '<input TYPE=image SRC=/lineup-2028.webp>', '<button><input type="image" src="/poster.jpg"></button>', '<festival-poster src="/announcement.jpg"></festival-poster>', '<template><img src="/poster.jpg"></template>', '<svg><animate attributeName="d" values="M0 0H300V200H0Z"/></svg>']) {
   review(base.replace('</header>', `${markup}</header>`));
  }
 }
});

test('changed or additional social-preview artwork returns to review', () => {
 const pinned='https://networksites.livenationinternational.com/networksites/vrudcnfc/firenze-rocks-share-image.jpg';
 review(svgFixture.replaceAll(pinned,'https://www.firenzerocks.it/lineup-2027.jpg'));
 for (const key of ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
  review(`<meta property="${key}" content="/poster-2028.jpg">${svgFixture}`);
 }
});
test('only known presentation-only header CSS is accepted, not image-bearing functions/properties', () => {
 for (const base of [svgFixture, fixture]) {
  for (const style of ["border:100px solid transparent;border-image:image-set('/lineup-2027.jpg' 1x) 100 fill", "list-style-image:image-set('/poster.jpg' 1x)", "mask-image:image-set('/poster.jpg' 1x)", "border-image:-webkit-image-set('/poster.jpg' 1x) 100 fill", 'filter:var(--unknown-artwork)', '--custom-image:image-set("/poster.jpg" 1x)']) {
   review(base.replace('<header', `<header style='${style.replaceAll("'",'"')}'`));
  }
 }
});

test('social links cannot conceal extra media or widgets beside their icon', () => {
 for (const base of [svgFixture, fixture]) {
  for (const markup of ['<video src="/lineup-2027.mp4"></video>', '<input type="image" src="/lineup-2027.jpg">', '<svg><path d="M0 0H300V200H0Z"></path></svg>', '<div><img src="/poster.jpg"></div>', '<iframe src="/tickets"></iframe>']) {
   review(base.replace(/(<a\b[^>]*href="https:\/\/www.facebook.com[^>]*>)/i, `$1${markup}`));
  }
 }
});
test('header controls must retain their count, home destinations and known accessible names', () => {
 for (const base of [svgFixture, fixture]) {
  for (const markup of ['<a href="/tickets" aria-label="Firenze Rocks 2027 tickets on sale"></a>', '<a href="/tickets" title="Tickets"></a>', '<a href="/tickets"></a>']) review(base.replace('</header>',`${markup}</header>`));
  review(base.replace('href="/"','href="/tickets"'));
  review(base.replace('href="/"','href="/" aria-label="Tickets on sale"'));
  review(base.replace('aria-label="Switch language. Current language is Italiano"','aria-label="Tickets on sale"'));
  review(base.replace('data-testid="lang-selector"','href="/tickets" data-testid="lang-selector"'));
 }
});

test('holding video cannot override its validated sources or conceal extra content', () => {
 for (const base of [svgFixture, fixture]) {
  for (const attr of ['src="/lineup-2027.mp4"', 'poster="/lineup-2027.jpg"', 'SRC=/lineup-2028.mp4', 'aria-label="2027 lineup"']) review(base.replace('<video', `<video ${attr}`));
  review(base.replace('</video>', '<input type="image" src="/poster.jpg"></video>'));
 }
});
test('main-content CSS cannot introduce artwork through image-set or unknown properties', () => {
 for (const base of [svgFixture, fixture]) {
  review(base.replace('<main', `<main style="border-image:image-set('/lineup-2027.jpg' 1x) 100 fill"`));
  review(base.replace('</main>', `<div style="mask-image:image-set('/poster.jpg' 1x)"></div></main>`));
 }
});
test('visible markup outside the validated header and main returns to review', () => {
 for (const base of [svgFixture, fixture]) {
  for (const markup of ['<img src="/lineup-2027.jpg" alt="2027 lineup">', '<h2>Tickets on sale 2027</h2>', '<video src="/poster.mp4"></video>', '<div style="background-image:url(/poster.jpg)"></div>']) {
   review(base+markup);review(markup+base);
  }
 }
});

test('other stripped regions cannot conceal artwork in legal markup or social srcset', () => {
 for (const base of [svgFixture, fixture]) {
  review(base.replace('Copyright ©', '<input type="image" src="/poster.jpg">Copyright ©'));
  review(base.replace('Termini e condizioni del sito','<input type="image" src="/poster.jpg">Termini e condizioni del sito'));
  review(base.replace(/(<a\b[^>]*href="https:\/\/www.facebook.com[^>]*><img)/i,'$1 srcset="/poster.jpg 2x"'));
 }
});
