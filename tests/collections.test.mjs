import assert from "node:assert/strict";
import test from "node:test";
import {readCollections,collectionsForSelection,collectionsForImport,mergeCollections} from "../lib/collections.ts";
const spotify={syncedAt:"2026-11-17T22:00:00.000Z",playlists:[{id:"abc",name:"Synthetic imported list",url:"https://open.spotify.com/playlist/abc",image:null,owner:"Synthetic provider",trackCount:3}]};
test("legacy local/provider/combined collections migrate both namespaces without inventing sync time",()=>{
 assert.deepEqual(readCollections({playlistFestivals:["wacken","wacken"]}),{schemaVersion:1,playlistFestivals:["wacken"],spotify:null});
 assert.deepEqual(readCollections({source:"spotify",...spotify}),{schemaVersion:1,playlistFestivals:[],spotify});
 const combined=readCollections({source:"spotify",...spotify,playlistFestivals:["wacken"]});
 assert.deepEqual(combined,{schemaVersion:1,playlistFestivals:["wacken"],spotify});
 assert.deepEqual(readCollections(combined),combined);
});
test("selection sync and merge never replace the provider namespace, including stale or forged client imports",()=>{
 const remote=collectionsForImport({playlistFestivals:["wacken"]},spotify);
 const forged={schemaVersion:1,playlistFestivals:["graspop"],spotify:{...spotify,syncedAt:"2020-01-01T00:00:00Z",playlists:[]}};
 assert.deepEqual(collectionsForSelection(remote,forged),{...remote,playlistFestivals:["graspop"]});
 assert.deepEqual(mergeCollections(remote,forged),{...remote,playlistFestivals:["wacken","graspop"]});
 assert.deepEqual(collectionsForImport(remote,{...spotify,playlists:[]}),{...remote,spotify:{...spotify,playlists:[]}});
});
test("unknown schemas, incomplete legacy imports and mismatched provider URLs fail closed",()=>{
 for(const value of [{schemaVersion:2,playlistFestivals:[],spotify:null},{source:"spotify",playlists:[]},{source:"spotify",syncedAt:spotify.syncedAt},{unrecognized:"keep me"}, {source:"spotify",...spotify,playlists:[{...spotify.playlists[0],url:"https://untrusted.example/playlist/abc"}]}])
  assert.throws(()=>readCollections(value));
 assert.deepEqual(readCollections(null),{schemaVersion:1,playlistFestivals:[],spotify:null});
});
