import type { PrismaClient } from '@prisma/client';
import { withPlaylistRefreshLease, type PlaylistLease } from './playlist-queue.ts';
import { YOUTUBE_URL, validateYoutubePlan, assertYoutubeScope, type YoutubeState, type YoutubeProgress } from './youtube-playlist-queue.ts';
export type YoutubePlaylistResult = {url:string;expectedUrl?:string;artists:number;tracks:number};

/** Publish only the verified result of this generation's YouTube operation. */
export async function publishYoutubeCheckpoint(db:PrismaClient,claim:PlaylistLease,result:YoutubePlaylistResult) {
 return withPlaylistRefreshLease(db,claim,async tx=>{
  const row=await tx.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:claim.id}});
  const plan=row.youtubePlan;validateYoutubePlan(plan);
  const expected=result.expectedUrl??result.url;
  const publication=await assertYoutubeScope(tx,claim,expected);
  const progress=row.youtubeProgress as YoutubeProgress|null,state=row.youtubeState as YoutubeState|null;
  if(plan.slug!==claim.festivalSlug||plan.editionYear!==publication.editionYear||plan.expectedUrl!==expected
   ||!YOUTUBE_URL.test(result.url)||result.tracks!==plan.videoIds.length||result.artists!==plan.artists
   ||!progress?.complete||progress.verifiedTracks!==result.tracks||state?.pendingInsert||state?.pendingMetadata)throw Error('Incomplete YouTube publication');
  if(expected!==result.url&&(!['','NEW'].includes(expected)||!state?.sent||result.url!==`https://music.youtube.com/playlist?list=${state.playlistId}`))throw Error('Unverified YouTube creation');
  const edition=await tx.festivalEdition.findFirstOrThrow({where:{festival:{slug:claim.festivalSlug},year:publication.editionYear,recordState:'CURRENT'}});
  const current=await tx.festivalPlaylist.findUnique({where:{editionId_provider:{editionId:edition.id,provider:'youtube_music'}}});
  if((current?.url??'')!==expected)throw Error('YouTube binding changed');
  const data={url:result.url,artistCount:result.artists,trackCount:result.tracks,syncedAt:new Date()};
  if(current){const updated=await tx.festivalPlaylist.updateMany({where:{id:current.id,url:expected},data});if(updated.count!==1)throw Error('YouTube binding changed')}
  else await tx.festivalPlaylist.create({data:{editionId:edition.id,provider:'youtube_music',...data}});
 });
}
