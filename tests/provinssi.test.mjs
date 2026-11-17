import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const html=readFileSync(new URL('./fixtures/official-markup/provinssi-excerpt.html',import.meta.url),'utf8');
const source={festivalSlug:'provinssi',url:'https://www.provinssi.fi/en/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'daily'};
const parse=(h=html,s={})=>extractFestivalCandidate(h,{...source,...s},'2026-11-17T11:00:00Z');
test('Provinssi official announcement has 19 unranked acts, dates and city',()=>{
 const c=parse();assert.equal(c.lineup.length,19);assert.ok(c.lineup.includes('Bullet For My Valentine'));assert.equal(c.headliners,undefined);assert.equal(c.startDate,'2027-07-01');assert.equal(c.endDate,'2027-07-03');assert.equal(c.city,'Seinäjoki');assert.deepEqual(c.warnings,[]);
});
test('Provinssi rejects wrong edition, URL, truncated slider, missing name and foreign artist URL',()=>{
 for(const [h,s]of [[html,{editionYear:2028}],[html,{url:'https://evil.test/'}],[html.replaceAll('2027','2026'),{}],[html.replace('</section>',''),{}],[html.replace('>JVG</h3>','></h3>'),{}],[html.replaceAll('https://www.provinssi.fi/en/artists/','https://evil.test/en/artists/'),{}],[html.replace('1.-3.7.2027','32.-33.7.2027'),{}]])assert.deepEqual(parse(h,s).evidence,[]);
});
test('Provinssi corroborated changed dates remain reviewable, additive replay preserves billing and omitted acts',()=>{
 const c=parse();const current={slug:'provinssi',editionYear:2027,startDate:c.startDate,endDate:c.endDate,city:c.city,status:'confirmed',headliners:[c.lineup[0]],lineup:[...c.lineup.slice(1),'Saved Artist'],ticketsUrl:c.ticketsUrl};
 assert.deepEqual(evaluateCandidate(current,c).changes,[]);
 const later=evaluateCandidate(current,parse(html.replace('1.-3.7.2027','8.-10.7.2027')));assert.ok(later.reviewReasons.length>0);assert.ok(!later.changes.some(c=>c.kind.endsWith('_removed')));
});
