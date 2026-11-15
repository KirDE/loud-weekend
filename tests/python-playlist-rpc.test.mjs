import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { playlistFailure, dispatchedPlaylistFailure } from '../lib/catalog/playlist-failure.ts';
import { executePlaylistJson } from '../lib/catalog/python-playlist-rpc.ts';

function run(program, value, overrides = {}) {
  return executePlaylistJson(process.execPath, ['-e', program], value, {
    cwd: process.cwd(), env: process.env, signal: new AbortController().signal, timeout: 5_000, ...overrides,
  });
}

test('playlist IPC roundtrips a large Unicode plan, with diagnostics separate from JSON', async () => {
  const value = { title: 'Фестиваль 演奏 🎸', plan: 'x'.repeat(1_100_000) };
  assert.deepEqual(await run(`let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{console.error('diagnostic');console.log(JSON.stringify(JSON.parse(s)))});`, value), value);
});

test('provider quota and reconciliation exits keep retry codes and never return partial success', async () => {
  for (const code of [2, 3]) {
    await assert.rejects(run(`process.stdin.resume();process.stdin.on('end',()=>{console.log('{}');console.error('provider_checkpoint');process.exit(${code})});`, {}), error => error.code === code && error.stderr === 'provider_checkpoint\n');
  }
  await assert.rejects(run(`process.stdin.resume();process.stdin.on('end',()=>console.log('not json'));`, {}), /Invalid playlist provider reply/);
});

test('IPC bounds input/output and respects cancellation/timeout', async () => {
  await assert.rejects(run('throw new Error("must not start")', 'x'.repeat(8 * 1024 * 1024)), /request too large/);
  await assert.rejects(run(`process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));`, {}), error => error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  await assert.rejects(run('setInterval(()=>{},1000)', {}, { timeout: 30 }), error => error.killed === true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run('setInterval(()=>{},1000)', {}, { signal: controller.signal }), error => error.name === 'AbortError');
});

test('database playlist worker has no file-backed plan/report exchange', async () => {
  const worker = await readFile('scripts/playlist-provider-worker.ts', 'utf8');
  assert.doesNotMatch(worker, /node:fs|mkdtemp|writeFile|readFile|reportPath|planPath|WORK_DIRECTORY/);
  for (const operation of ['discover-spotify', 'apply-spotify', 'discover-youtube', 'apply-youtube']) assert.ok(worker.includes(operation));
  assert.match(worker, /stagePlaylistPlan/); assert.match(worker, /stageYoutubePlan/);
  assert.match(worker, /publishSpotifyCheckpoint/); assert.match(worker, /PLAYLIST_LEASE/);
});


test('a real RPC deadline survives sanitization without accepting partial JSON or exposing stderr', async () => {
  await assert.rejects(run(`console.error('private token');console.log('{}');setInterval(()=>{},1000)`, {}, {timeout: 150}), error => {
    assert.equal(error.killed, true);
    assert.equal(error.playlistRpcTimedOut,true);
    const line=playlistFailure('spotify_discovery',error);
    assert.equal(line,'playlist_worker_failed stage=spotify_discovery reason=playlist_rpc_timeout');
    assert.equal(dispatchedPlaylistFailure({stderr:line}),line);
    return true;
  });
  const controller=new AbortController();
  const pending=run('setInterval(()=>{},1000)', {}, {signal:controller.signal,timeout:5000});
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' && !error.playlistRpcTimedOut);
});


test('deadline evidence never masks an explicit provider quota or uncertain-write reason', () => {
  for (const reason of ['youtube_provider_rejected_403_quotaExceeded','youtube_insert_unknown_no_resend']) {
    assert.equal(playlistFailure('youtube_apply',{playlistRpcTimedOut:true,stderr:reason}),`playlist_worker_failed stage=youtube_apply reason=${reason}`);
  }
});


test('a generic RPC marker cannot mask a real deadline', async () => {
  await assert.rejects(run(`console.error('playlist_rpc_failed');setInterval(()=>{},1000)`, {}, {timeout:150}), error => {
    assert.equal(playlistFailure('spotify_discovery',error),'playlist_worker_failed stage=spotify_discovery reason=playlist_rpc_timeout');
    return true;
  });
});

test('deadline closes inherited pipes even after the direct worker exits successfully', async () => {
  const started=Date.now();
  const program = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},1400)'],{detached:true,stdio:['ignore',1,2]});child.unref();console.log('{}');`;
  await assert.rejects(run(program, {}, {timeout:150}), error => error.playlistRpcTimedOut === true);
  assert.ok(Date.now()-started < 1000, 'RPC must not wait for detached descendant');
});
