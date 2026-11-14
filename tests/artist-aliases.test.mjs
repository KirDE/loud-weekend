import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { artistAliasIndex, canonicalArtistNames } from '../lib/catalog/artist-aliases.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const fixture=JSON.parse(await readFile(new URL('./fixtures/rock-am-ring-orthography-20261114.json', import.meta.url),'utf8'));
const artists=[{id:'1',slug:'canonical',name:'Canonical Band',aliases:['Old Band Name','別名']}];
const evaluate=(before,after,options={})=>evaluateCandidate({...fixture.current,headliners:[],lineup:before},{...fixture.candidate,headliners:[],lineup:after,...options},artists);
test('DB aliases including alternate scripts resolve to one stable identity',()=>{
 assert.equal(artistAliasIndex(artists)('別名')[0].id,'1');
 for(const [before,after] of [['Canonical Band','Old Band Name'],['Old Band Name','別名']]) {
 const r=evaluate([before],[after]);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(r.publishable,false); }
});
test('unknown names and genuine removals remain changes; no fuzzy matching',()=>{
 assert.ok(evaluate(['Canonical Band'],['Canonical Bands']).reviewReasons.includes('Removals require confirmation'));
 assert.deepEqual(evaluate(['Canonical Band'],['Old Band Name','New Act']).changes.map(c=>c.after),['New Act']);
 assert.ok(evaluate(['Canonical Band','Real Removed'],['Old Band Name']).reviewReasons.includes('Removals require confirmation'));
});
test('duplicate aliases and cross-billing duplicates do not silently collapse',()=>{
 for(const names of [['Canonical Band','Old Band Name'],['別名','Old Band Name']]) assert.ok(evaluate(['Canonical Band'],names).reviewReasons.some(r=>r.includes('Duplicate artist alias')));
 const r=evaluateCandidate({...fixture.current,headliners:['Canonical Band'],lineup:[]},{...fixture.candidate,headliners:['Canonical Band'],lineup:['Old Band Name']},artists);
 assert.equal(r.publishable,false);assert.ok(r.reviewReasons.some(r=>r.includes('Duplicate artist alias')));
});
test('global alias collisions, including archived canonical names, fail closed',()=>{
 const collision=[...artists,{id:'2',slug:'archived',name:'Old Band Name',aliases:[]}];
 assert.equal(artistAliasIndex(collision)('Old Band Name').length,2);
 assert.ok(canonicalArtistNames(['Old Band Name'],collision).warnings.some(r=>r.includes('Ambiguous')));
 const r=evaluateCandidate({...fixture.current,headliners:[],lineup:['Canonical Band']},{...fixture.candidate,headliners:[],lineup:['Old Band Name']},collision);
 assert.equal(r.publishable,false);assert.ok(r.reviewReasons.some(r=>r.includes('Ambiguous artist alias')));
});
test('billing moves require review; partial announcement retains known headliner',()=>{
 const current={...fixture.current,headliners:['Canonical Band'],lineup:[]};
 const c={...fixture.candidate,headliners:[],lineup:['Old Band Name']};
 assert.ok(evaluateCandidate(current,c,artists).changes.some(c=>c.kind==='headliner_removed'));
 assert.deepEqual(evaluateCandidate(current,{...c,headliners:undefined,lineupScope:'announcement'},artists).changes,[]);
});
test('source evidence is preserved and caller inputs are not mutated',()=>{
 const c={...fixture.candidate,headliners:[],lineup:['別名']};const original=structuredClone(c);
 const r=evaluateCandidate({...fixture.current,headliners:[],lineup:['Canonical Band']},c,artists);
 assert.deepEqual(c,original);assert.deepEqual(r.candidate,original);
});
test('unregistered formatting variants do not bypass additive billing review',()=>{
 const a=[{id:'h',slug:'hanabie',name:'HANABIE.',aliases:[]}];
 const current={...fixture.current,headliners:['HANABIE.'],lineup:[]};
 const c={...fixture.candidate,headliners:undefined,lineup:['Hanabie'],lineupScope:'announcement',artistListMode:'additive'};
 const r=evaluateCandidate(current,c,a);assert.ok(r.reviewReasons.length);assert.ok(r.changes.some(c=>c.after==='Hanabie'));
});

test('Unicode collision identities use the same NFC in every index mode',()=>{
 const records=[{id:'u',slug:'beyonce',name:'Beyoncé',aliases:[]}];
 for(const orthography of [true,false]) assert.equal(artistAliasIndex(records,{orthography})('Beyonce\u0301')[0].id,'u');
});
