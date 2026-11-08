import path from 'node:path';
import {Prisma} from '@prisma/client';
import { publishYoutubeCheckpoint } from '../lib/catalog/youtube-playlist-checkpoint.ts';
import { db } from '../lib/db.ts';
import { acquireProviderProcessLock } from '../lib/catalog/playlist-process-lock.ts';
import { readCatalog } from '../lib/catalog/repository.ts';
import { stagePlaylistPlan, assertSpotifyPlanCurrent } from '../lib/catalog/playlist-queue.ts';
import { publishSpotifyCheckpoint } from '../lib/catalog/spotify-playlist-checkpoint.ts';
import { stageYoutubePlan, validateYoutubePlan, YOUTUBE_URL } from '../lib/catalog/youtube-playlist-queue.ts';
import { executePlaylistJson } from '../lib/catalog/python-playlist-rpc.ts';
import { spotifyRepertoiresForArtists } from '../lib/catalog/spotify-repertoire.ts';
import { runProviderWorker, requestedProviders, type PlaylistProvider } from '../lib/catalog/playlist-provider-worker.ts';
import { playlistFailure, type PlaylistStage } from '../lib/catalog/playlist-failure.ts';
const provider=process.argv[2] as PlaylistProvider;
let release:(()=>Promise<void>)|undefined,stage:PlaylistStage='setup';
const root=process.cwd();
try {
 if(!['spotify','youtube_music'].includes(provider))throw Error('Explicit playlist provider required');
 release=await acquireProviderProcessLock(provider);
 const result=await runProviderWorker(db,provider,async(claim,guard,signal)=>{
  const publication=await db.catalogPublication.findUniqueOrThrow({where:{id:claim.publicationId}});
  const snapshot=await readCatalog({database:db});
  const festival=snapshot.festivals.find(f=>f.slug===claim.festivalSlug&&f.editionYear===publication.editionYear);
  if(!festival)throw Error('Current festival required');
  const env={...process.env,FESTIVAL_WORKER_STDIO:'1',FESTIVAL_REPORT_ONLY:'1',PYTHONDONTWRITEBYTECODE:'1',FESTIVALS:festival.slug,PLAYLIST_PROVIDER:provider,PLAYLIST_LEASE:JSON.stringify(claim),PLAYLIST_GUARD_NODE:process.execPath,PLAYLIST_GUARD_SCRIPT:path.join(root,'scripts/playlist-lease-guard.ts'),YOUTUBE_GUARD_SCRIPT:path.join(root,'scripts/playlist-lease-guard.ts')};
  const execute=(op:string,value:unknown,extra:Partial<NodeJS.ProcessEnv>={})=>executePlaylistJson(process.env.PLAYLIST_PYTHON??'python3',[path.join(root,'scripts/spotify_gmm_2026/playlist_worker_rpc.py'),op],value,{cwd:root,env:{...env,...extra},signal,timeout:600_000});
  let plan=(await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:claim.id}})).desiredPlan as Record<string,any>|null;
  if(provider==='spotify'){
   const url=snapshot.playlists[festival.slug]?.spotifyUrl??'';
   if(!plan){
    stage='spotify_discovery';const names=new Set([...festival.headliners,...festival.lineup]);
    const profiles=await spotifyRepertoiresForArtists(db,snapshot.artists.filter(a=>names.has(a.name)));
    plan=await execute('discover-spotify',{season:publication.editionYear,festivals:[{...festival,spotifyRepertoireProfiles:profiles,artists:[...names],playlistUrl:url}]}) as Record<string,any>;
    plan=await stagePlaylistPlan(db,claim,plan) as Record<string,any>;
   }
   await guard();await assertSpotifyPlanCurrent(db,claim);
   stage='spotify_apply';
   const report=await execute('apply-spotify',plan,{PLAYLIST_EXPECTED_URL:url}) as {playlist_url:string;artists_count:number;track_count:number};
   stage='spotify_checkpoint';
   await publishSpotifyCheckpoint(db,claim,{url:report.playlist_url,artists:report.artists_count,tracks:report.track_count,expectedUrl:url});
  }else{
   // Discovery uses the frozen song report, never a Spotify API call or write.
   if(!plan){
    if(requestedProviders(publication.evidence).includes('spotify'))throw Error('Own Spotify song report not staged yet');
    const sibling=await db.catalogPlaylistRefresh.findFirst({where:{festivalSlug:festival.slug,desiredPlan:{not:Prisma.DbNull},publication:{editionYear:publication.editionYear}},orderBy:{requestedAt:'desc'}});
    plan=sibling?.desiredPlan as Record<string,any>|null;
    if(!plan)throw Error('Spotify song report not staged yet');
    const norm=(n:string)=>n.toLowerCase().replace(/[^a-z0-9]/g,'');
    const names=new Set((plan.report??[]).map((r:{artist:string})=>norm(r.artist)));
    if([...festival.headliners,...festival.lineup].some(n=>!names.has(norm(n))&&!/ tribute/i.test(n)))throw Error('Song report does not cover current lineup');
    // A YouTube-only publication must not stage a Spotify plan: that would
    // falsely supersede the existing Spotify generation across providers.
   }
   const binding=await db.festivalPlaylist.findFirst({where:{provider:'youtube_music',edition:{festival:{slug:festival.slug},year:publication.editionYear,recordState:'CURRENT'}}});
   const url=binding?.url??'';
   if(!['','NEW'].includes(url)&&!YOUTUBE_URL.test(url))throw Error('Invalid YouTube binding');
   let youtubePlan:unknown=(await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:claim.id}})).youtubePlan;
   if(!youtubePlan){stage='youtube_discovery';youtubePlan=await execute('discover-youtube',{slug:festival.slug,editionYear:publication.editionYear,expectedUrl:url,sourceReport:plan});youtubePlan=await stageYoutubePlan(db,claim,youtubePlan)}
   validateYoutubePlan(youtubePlan);
   if(youtubePlan.slug!==festival.slug||youtubePlan.editionYear!==publication.editionYear||youtubePlan.expectedUrl!==url)throw Error('Durable YouTube binding mismatch');
   stage='youtube_apply';const result=await execute('apply-youtube',youtubePlan,{YOUTUBE_EXPECTED_URL:url}) as {url:string;expectedUrl:string;artists:number;tracks:number};
   stage='commit';
   await publishYoutubeCheckpoint(db,claim,result);
  }
 },()=>stage);
 console.log(JSON.stringify(result));
 // Failed provider state is durable; the other provider has its own unit/timer.
 if(result.status==='FAILED')process.exitCode=1;
}catch(error){console.error(playlistFailure(stage,error));process.exitCode=1}
finally{await release?.();await db.$disconnect()}
