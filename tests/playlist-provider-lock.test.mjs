import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {acquireProviderProcessLock,acquirePlaylistProcessLock} from '../lib/catalog/playlist-process-lock.ts';
test('providers run independently; duplicate providers and legacy exclusive writers remain fenced',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'provider-lock-'));const previous=process.env.APP_ROOT;process.env.APP_ROOT=root;
 let spotify,youtube,legacy;
 try{
  spotify=await acquireProviderProcessLock('spotify');youtube=await acquireProviderProcessLock('youtube_music');
  await assert.rejects(acquireProviderProcessLock('spotify'),/already running|unavailable/);
  await assert.rejects(acquirePlaylistProcessLock(),/already running|unavailable/);
  await youtube();youtube=undefined;await spotify();spotify=undefined;
  legacy=await acquirePlaylistProcessLock();await assert.rejects(acquireProviderProcessLock('spotify'),/already running|unavailable/);
 }finally{await legacy?.();await youtube?.();await spotify?.();if(previous===undefined)delete process.env.APP_ROOT;else process.env.APP_ROOT=previous;await rm(root,{recursive:true,force:true})}
});
