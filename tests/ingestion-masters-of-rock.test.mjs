import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { parserSource } from './support/parser-source.ts';
const html = await readFile(new URL('./fixtures/masters-of-rock-2027-home.html', import.meta.url), 'utf8');
const source = parserSource('masters-of-rock', { url: 'https://www.mastersofrock.cz/', strategies: ['json_ld_event', 'html_fallback'] });
const parse = (value = html, s = source) => extractFestivalCandidate(value, s, '2026-10-10T14:39:00Z');
const expected = ['Judas Priest','Slash','Bruce Dickinson','Skillet','Alestorm','Amaranthe','Lord Of The Lost','Therion','Dartagnan','Septicflesh','Freedom Call','Gaerea','Eclipse','Crematory','Nervosa','April Art','Emil Bulls','Samurai Pizza Cats','Vindicta','Die Happy','Melissa Bonny','Wizardthrone','Roses of Thieves','Seasons In Black','Doga'];
const current = { slug: 'masters-of-rock', editionYear: 2027, city: 'Vizovice', startDate: '2027-07-08', endDate: '2027-07-11', status: 'partial', lineup: expected, headliners: [], ticketsUrl: 'https://www.mastersofrock.cz/cs/masters-of-rock-vstupenky', ticketStatus: 'available' };

test('real corrected home extracts all 25 unranked acts, dates and festival tickets, not headings or merchandise', () => {
  const c = parse();
  assert.deepEqual(c.lineup, expected);
  assert.equal(c.headliners, undefined);
  assert.equal(c.status, 'partial');
  assert.equal(c.startDate, current.startDate);
  assert.equal(c.endDate, current.endDate);
  assert.equal(c.ticketsUrl, current.ticketsUrl);
  assert.equal(c.ticketStatus, 'available');
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(evaluateCandidate(current, c).changes, []);
  assert.deepEqual(evaluateCandidate(current, c).reviewReasons, []);
});

test('later additions, apostrophes, ampersands and reordered artists are not frozen to the corrected document', () => {
  const c = parse(html.replace('<span data-mor-band>Judas Priest</span>', '<span data-mor-band>New &amp; Future Band</span><span data-mor-band>Judas Priest</span><span data-mor-band>Artist&#39;s Project</span>'));
  assert.deepEqual(c.lineup, ['New & Future Band', 'Judas Priest', "Artist's Project", ...expected.slice(1)]);
  assert.equal(c.status, 'partial');
  const decision = evaluateCandidate(current, c);
  assert.equal(decision.publishable, true);
  assert.deepEqual(decision.reviewReasons, []);
  assert.deepEqual(decision.changes.map(x => x.kind), ['artist_added', 'artist_added']);
});

test('future edition changes require matching source edition, and invalid dates fail closed', () => {
  const future = html.replaceAll('2027', '2028').replace('08–11.07.2028', '06–09.07.2028');
  assert.equal(parse(future).lineup, undefined);
  assert.ok(parse(future).warnings.some(x => x.includes('does not match')));
  const c = parse(future, { ...source, editionYear: 2028 });
  assert.equal(c.startDate, '2028-07-06');
  assert.equal(c.endDate, '2028-07-09');
  assert.deepEqual(c.lineup, expected);
  assert.equal(c.ticketStatus, 'available');
  assert.deepEqual(c.warnings, []);
  assert.equal(parse(html.replace('08–11.07.2027', '30–31.02.2027')).lineup, undefined);
});

test('comments/news/featured cards and duplicate heroes cannot contaminate current performers', () => {
  const poisoned = '<!--<aside class="mor-hero-side"><span data-mor-band>Archived Artist</span></aside>-->' + html + '<section class="mor-news-section"><span data-mor-band>Unrelated Concert</span></section>';
  assert.deepEqual(parse(poisoned).lineup, expected);
  assert.equal(parse(html.replace(/data-mor-band/g, 'data-not-a-band')).lineup, undefined);
  assert.ok(parse(html.replace(/data-mor-band/g, 'data-not-a-band')).warnings.length);
  assert.equal(parse(html.replace('data-mor-state="active"', 'data-mor-state="archived"')).lineup, undefined);
  const hero = html.match(/<aside\b[\s\S]*?<\/aside>/)[0];
  assert.equal(parse(html + hero).lineup, undefined);
});

test('missing, disabled, archived and sold-out purchase cards do not infer availability from a price deadline', () => {
  for (const variant of [html.replaceAll('Koupit vstupenku ↗', 'Informace'), html.replaceAll('class="btn btn-primary">Koupit vstupenku', 'aria-disabled="true" class="btn btn-primary">Koupit vstupenku'), html.replaceAll('/cs/koncerty/2027-masters-of-rock', '/cs/koncerty/2026-masters-of-rock'), html.replace('Na stání</h3>', 'Na stání vyprodáno</h3>')]) {
    assert.equal(parse(variant).ticketStatus, undefined);
  }
  assert.equal(parse(html.replaceAll('/cs/masters-of-rock-vstupenky', '/cs/e-shop/')).ticketsUrl, undefined);
  assert.equal(parse(html.replaceAll('/cs/masters-of-rock-vstupenky', 'https://other.example/cs/masters-of-rock-vstupenky')).ticketsUrl, undefined);
});

test('partial list shrinkage stays review-required and cannot overwrite independently verified acts', () => {
  const c = parse(html.replace('<span data-mor-band>Doga</span>', ''));
  const d = evaluateCandidate(current, c);
  assert.equal(d.publishable, false);
  assert.ok(d.reviewReasons.includes('Removals require confirmation'));
});


test('ticket inventory ignores archived sections, seating sellouts and the conditional price deadline',()=>{
 const archived=html.match(/<section class="mor-content-section mor-price-section"[^]*?<\/section>/)[0].replaceAll('2027','2026').replaceAll('Koupit vstupenku ↗','Vyprodáno');
 const seated=html.replace('Tribuna Platinum</h3>','Tribuna Platinum vyprodáno</h3>');
 assert.equal(parse(seated+archived).ticketStatus,'available');
 assert.deepEqual(parse(seated+archived).warnings,[]);
});

test('an explicit current standard-pass sellout is distinct from ambiguous unavailability',()=>{
 const sold=html.replace('Na stání</h3>','Na stání vyprodáno</h3>').replace(/<a href="\/cs\/koncerty\/2027-masters-of-rock"[^]*?<\/a>/,'');
 const c=parse(sold);assert.equal(c.ticketStatus,'sold_out');
 assert.ok(c.evidence.some(e=>e.field==='ticketStatus' && e.sourceUrl===source.url && e.excerpt.includes('vyprodáno')));
 assert.equal(evaluateCandidate(current,c).changes.find(e=>e.field==='ticketStatus').after,'sold_out');
});

test('contradictory current stock retains last verified availability for review',()=>{
 const c=parse(html.replace('Na stání</h3>','Na stání vyprodáno</h3>'));
 assert.equal(c.ticketStatus,undefined);
 assert.ok(c.warnings.some(w=>w.includes('stock conflicts')));
 assert.equal(evaluateCandidate(current,c).publishable,false);
});

test('hidden, stale, duplicate or foreign ticket inventory cannot establish current availability',()=>{
 const section=html.match(/<section class="mor-content-section mor-price-section"[^]*?<\/section>/)[0];
 const cases=[
  html.replace('class="mor-content-section mor-price-section"','hidden class="mor-content-section mor-price-section"'),
  html.replace('class="mor-price-card custom-inner-bg is-primary"','style="display:none" class="mor-price-card custom-inner-bg is-primary"'),
  html.replace('class="mor-hero-side custom-inner-bg"','aria-hidden="true" class="mor-hero-side custom-inner-bg"'),
  html.replace('Masters of Rock 2027\t','Masters of Rock 2026\t'),
  html+section,
  html.replaceAll('/cs/koncerty/2027-masters-of-rock','https://other.example/cs/koncerty/2027-masters-of-rock'),
  html.replaceAll('/cs/koncerty/2027-masters-of-rock','https://user@www.mastersofrock.cz/cs/koncerty/2027-masters-of-rock'),
 ];
 for(const document of cases) assert.equal(parse(document).ticketStatus,undefined);
 assert.equal(parse(html,{...source,url:'https://other.example/'}).ticketStatus,undefined);
});

test('minified element boundaries preserve a valid standard four-day pass',()=>{
 const minified=html.replace(/>\s+</g,'><');
 assert.equal(parse(minified).ticketStatus,'available');
 assert.deepEqual(parse(minified).warnings,[]);
 const currentCard=minified.match(/<article[^]*?Na stání[^]*?<\/article>/)[0];
 const noDuration=minified.replace(currentCard,currentCard.replace('4 dny','1 den')+'<small>4 dny archived promotion</small>');
 assert.equal(parse(noDuration).ticketStatus,undefined);
});
