import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const helper=await readFile('scripts/deploy/provider-timers.sh','utf8');
async function run(action,fail=''){
 const root=await mkdtemp(path.join(tmpdir(),'provider-timers-'));
 try{
  const result=spawnSync('bash',['-c',`set -euo pipefail
service=festival-radar
systemctl(){ printf '%s\\n' "$*" >> "$CHECK_LOG"; if [[ "$1" == show ]]; then echo loaded; fi; [[ "$*" != "$FAIL_CALL" ]]; }
${helper}
${action}`],{env:{...process.env,CHECK_LOG:path.join(root,'calls'),FAIL_CALL:fail},encoding:'utf8'});
  return {...result,log:await readFile(path.join(root,'calls'),'utf8')};
 }finally{await rm(root,{recursive:true,force:true})}
}
test('provider timers enable independently without stopping in-flight services',async()=>{
 const result=await run('install_provider_timers');assert.equal(result.status,0,result.stderr);
 assert.match(result.log,/enable --now festival-radar-collection-playlists-db.timer/);
 assert.match(result.log,/enable --now festival-radar-collection-playlists-youtube.timer/);
 assert.doesNotMatch(result.log,/stop .*service/);
});
test('partial timer activation inhibits both providers without interrupting service writes',async()=>{
 for(const job of ['playlists-db','playlists-youtube']){
  const result=await run('install_provider_timers',`enable --now festival-radar-collection-${job}.timer`);assert.equal(result.status,6);
  for(const stopped of ['playlists-db','playlists-youtube'])assert.ok(result.log.includes(`disable --now festival-radar-collection-${stopped}.timer`));
  assert.doesNotMatch(result.log,/stop .*service/);
 }
});
test('timer pause attempts both providers and propagates failure',async()=>{
 const result=await run('pause_provider_timers','disable --now festival-radar-collection-playlists-db.timer');assert.notEqual(result.status,0);
 assert.match(result.log,/disable --now festival-radar-collection-playlists-youtube.timer/);
});
