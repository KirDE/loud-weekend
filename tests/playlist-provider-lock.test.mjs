import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {acquireProviderProcessLock} from '../lib/catalog/playlist-process-lock.ts';
test('providers run independently; duplicate provider writers remain fenced',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'provider-lock-'));const previous=process.env.APP_ROOT;process.env.APP_ROOT=root;
 let spotify,youtube;
 try{
  spotify=await acquireProviderProcessLock('spotify');youtube=await acquireProviderProcessLock('youtube_music');
  await assert.rejects(acquireProviderProcessLock('spotify'),/already running|unavailable/);
  await youtube();youtube=undefined;await spotify();spotify=undefined;
 }finally{await youtube?.();await spotify?.();if(previous===undefined)delete process.env.APP_ROOT;else process.env.APP_ROOT=previous;await rm(root,{recursive:true,force:true})}
});
