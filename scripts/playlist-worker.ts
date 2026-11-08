/** Compatibility entrypoint. Providers execute in independent child processes.
 * Timers invoke each provider directly; this route retains existing API support. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const results=await Promise.allSettled(['spotify','youtube_music'].map(provider=>execute(process.execPath,['--experimental-strip-types','scripts/playlist-provider-worker.ts',provider],{env:process.env,timeout:2_650_000,maxBuffer:1024*1024})));
for(let i=0;i<results.length;i++){const result=results[i];if(result.status==='fulfilled')process.stdout.write(result.value.stdout);else{process.stderr.write(`playlist_provider_failed provider=${['spotify','youtube_music'][i]}\n`);process.exitCode=1}}
