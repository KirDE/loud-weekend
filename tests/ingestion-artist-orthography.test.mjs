import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const fixture=JSON.parse(await readFile(new URL('./fixtures/rock-am-ring-orthography-20261114.json',import.meta.url),'utf8'));
const evaluate=(before,after,options={})=>evaluateCandidate({...fixture.current,headliners:[],lineup:before},{...fixture.candidate,headliners:[],lineup:after,...options});
test('exact persisted Rock am Ring75-artist case is unchanged, not four false changes',()=>{
 const r=evaluateCandidate(fixture.current,fixture.candidate);
 assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(r.publishable,false);
});
test('later addition remains publishable; genuine removals still require review',()=>{
 assert.deepEqual(evaluate(['HANABIE.'],['Hanabie','Later Act']).changes.map(c=>[c.kind,c.after]),[['artist_added','Later Act']]);
 const r=evaluate(['HANABIE.','Real Removed'],['Hanabie']);
 assert.deepEqual(r.changes.map(c=>[c.kind,c.before]),[['artist_removed','Real Removed']]);assert.ok(r.reviewReasons.includes('Removals require confirmation'));
});
test('ambiguous formatting siblings never collapse, in either direction',()=>{
 const r=evaluate(['Hanabie','HANABIE.'],['Hanabie']);assert.deepEqual(r.changes.map(c=>[c.kind,c.before]),[['artist_removed','HANABIE.']]);assert.equal(r.publishable,false);
 assert.deepEqual(evaluate(['HANABIE.'],['Hanabie','HANABIE.']).changes.map(c=>[c.kind,c.after]),[['artist_added','Hanabie']]);
});
test('real punctuation differences and billing moves remain changes',()=>{
 assert.ok(evaluate(['AC/DC'],['AC DC']).reviewReasons.includes('Removals require confirmation'));
 const r=evaluateCandidate({...fixture.current,headliners:['HANABIE.'],lineup:[]},{...fixture.candidate,headliners:[],lineup:['Hanabie']});
 assert.ok(r.changes.some(c=>c.kind==='headliner_removed'));assert.equal(r.publishable,false);
});
test('announcement skips formatting-equivalent known headliner without changing billing',()=>{
 const r=evaluateCandidate({...fixture.current,headliners:['HANABIE.'],lineup:[]},{...fixture.candidate,headliners:undefined,lineup:['Hanabie'],lineupScope:'announcement'});assert.deepEqual(r.changes,[]);
});
test('cross-billing formatting siblings retain their separate removal guard',()=>{
 const r=evaluateCandidate({...fixture.current,headliners:['HANABIE.'],lineup:['Hanabie']},{...fixture.candidate,headliners:['Hanabie'],lineup:[]});
 assert.ok(r.changes.some(c=>c.kind==='headliner_removed'));assert.equal(r.publishable,false);
});
