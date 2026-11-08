import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,chmod,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import test from 'node:test';
const installer=await readFile('scripts/deploy/install-release.sh','utf8'),sha='a'.repeat(40);
function section(start,end){const a=installer.indexOf(start),b=installer.indexOf(end,a);assert.ok(a>=0&&b>a);return installer.slice(a,b)}
const snapshot=section('scheduler_state=/var/lib/festival-radar-scheduler','install -m 0600 "$env_source"');
const rearm=section('if [[ "$db_due_timer_was_armed" == true ]]; then','\ndb_due_assets_armed=false');
async function fixture({armed=true,enabled,active,healthSha=sha,failEnable=false}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'due-rearm-')),root=path.join(dir,'root'),release=path.join(root,'releases',sha),state=path.join(dir,'state');
 await mkdir(release,{recursive:true});await mkdir(state,{mode:0o755});await chmod(state,0o755);await symlink(release,path.join(root,'current'));await writeFile(path.join(release,'DEPLOYED_COMMIT'),sha);await mkdir(path.join(release,'.runtime'));await symlink(process.execPath,path.join(release,'.runtime/node'));await writeFile(path.join(dir,'timer'),'timer');
 await writeFile(path.join(dir,'enabled'),enabled??(armed?'enabled':'disabled'));await writeFile(path.join(dir,'active'),active??(armed?'active':'inactive'));
 const stub=String.raw`systemctl(){ printf '%s\n' "$*" >> "$CHECK_DIR/calls"; case "$1" in is-enabled) cat "$CHECK_DIR/enabled";; is-active) if [[ "$2" == *db-due.timer ]]; then cat "$CHECK_DIR/active"; else echo inactive; fi;; enable) printf enabled > "$CHECK_DIR/enabled";printf active > "$CHECK_DIR/active";[[ "$FAIL_ENABLE" == false ]];; disable) printf disabled > "$CHECK_DIR/enabled";printf inactive > "$CHECK_DIR/active";; esac; }
curl(){ printf '{"status":"ok","database":"ok","catalog":"database","commit":"%s"}' "$HEALTH_SHA"; }`;
 const pre=snapshot.replace('scheduler_state=/var/lib/festival-radar-scheduler','scheduler_state="$CHECK_DIR/state"').replaceAll('/etc/systemd/system/festival-radar-db-due.timer','"$CHECK_DIR/timer"').replaceAll('0:755',process.getuid()+':755');
 const post='service=festival-radar; app_root="$CHECK_DIR/root"; release="$CHECK_DIR/root/releases/'+sha+'"; commit="'+sha+'"; port=3100;\n'+rearm;
 const result=spawnSync('bash',['-c','set -euo pipefail\n'+stub+'\n'+pre+'\n'+post],{encoding:'utf8',env:{...process.env,CHECK_DIR:dir,HEALTH_SHA:healthSha,FAIL_ENABLE:String(failEnable)}});
 return {dir,result,log:await readFile(path.join(dir,'calls'),'utf8').catch(()=>''),active:await readFile(path.join(dir,'active'),'utf8')};
}
test('previously armed ingestion timer rearms only after exact database-backed release health',async()=>{const h=await fixture();try{assert.equal(h.result.status,0,h.result.stderr);assert.match(h.log,/enable --now festival-radar-db-due.timer/)}finally{await rm(h.dir,{recursive:true,force:true})}});
test('deployment preserves an operator pause',async()=>{const h=await fixture({armed:false});try{assert.equal(h.result.status,0,h.result.stderr);assert.doesNotMatch(h.log,/enable --now/);assert.equal(h.active,'inactive')}finally{await rm(h.dir,{recursive:true,force:true})}});
test('ambiguous current timer states refuse deployment',async()=>{for(const values of [{enabled:'enabled',active:'inactive'},{enabled:'disabled',active:'active'},{enabled:'unknown',active:'failed'}]){const h=await fixture(values);try{assert.equal(h.result.status,6);assert.doesNotMatch(h.log,/enable --now/)}finally{await rm(h.dir,{recursive:true,force:true})}}});
test('wrong release health and partial activation never leave fetching armed',async()=>{for(const values of [{healthSha:'b'.repeat(40)},{failEnable:true}]){const h=await fixture(values);try{assert.equal(h.result.status,6);assert.equal(h.active,'inactive')}finally{await rm(h.dir,{recursive:true,force:true})}}});
