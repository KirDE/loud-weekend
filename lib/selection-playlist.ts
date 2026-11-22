import path from "node:path";
import { executePlaylistJson } from "./catalog/python-playlist-rpc.ts";
import { spotifyRepertoireSchema, type SpotifyRepertoireProfile } from "./catalog/spotify-repertoire.ts";

export type SelectionArtist={requestedName:string;name:string;slug:string|null;spotifyId:string|null;repertoire?:SpotifyRepertoireProfile};
export type SpotifyRequest = (url: string, init?: RequestInit) => Promise<Response>;

export function deduplicateArtists(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase("en");
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function spotifyJson<T>(request: SpotifyRequest, url: string, init?: RequestInit) {
  const response = await request(url, init);
  if (!response.ok) throw new Error(`Spotify request failed (${response.status})`);
  return response.json() as Promise<T>;
}


const providerId=/^[A-Za-z0-9]{22}$/;
async function selectionPool(artist:SelectionArtist,request:SpotifyRequest,headers:Record<string,string>) {
 const profile=artist.repertoire?spotifyRepertoireSchema.parse(artist.repertoire):undefined;
 if(!profile&&!artist.spotifyId)return [];
 if(profile&&(!artist.slug||!profile.artistSlugs.includes(artist.slug)))throw new Error("Mismatched repertoire binding");
 const artistIds=profile?profile.searchArtists.map(a=>a.id):[artist.spotifyId!];
 if(artistIds.some(id=>!providerId.test(id)))throw new Error("Invalid canonical Spotify identity");
 const pool:Record<string,unknown>[]=[];
 const get=(url:string)=>spotifyJson<Record<string,unknown>>(request,url,{headers,cache:"no-store"});
 for(const id of artistIds){
  const data=await get("https://api.spotify.com/v1/artists/"+id+"/top-tracks?market=DE");
  if(!Array.isArray(data.tracks)||data.tracks.length>100)throw new Error("Invalid Spotify top tracks");
  pool.push(...data.tracks);
 }
 if(profile){
  const ids=new Set<string>();
  for(const album of profile.albumIds){
   for(let offset=0;;offset+=50){
    if(offset>=200)throw new Error("Reviewed album tracklist exceeds bound");
    const page=await get("https://api.spotify.com/v1/albums/"+album+"/tracks?limit=50&offset="+offset+"&market=DE");
    if(!Array.isArray(page.items)||page.items.length>50||!(page.next===null||typeof page.next==="string"))throw new Error("Invalid reviewed album tracks");
    for(const track of page.items){if(!track||!providerId.test(track.id))throw new Error("Invalid reviewed album track identity");ids.add(track.id);}
    if(!page.next)break;
    const next=new URL(page.next);
    if(next.origin!=="https://api.spotify.com"||next.pathname!=="/v1/albums/"+album+"/tracks"||next.username||next.password||next.hash||Number(next.searchParams.get("offset"))!==offset+50)throw new Error("Unexpected reviewed album pagination");
   }
  }
  const list=[...ids];
  for(let offset=0;offset<list.length;offset+=50){
   const requested=list.slice(offset,offset+50),data=await get("https://api.spotify.com/v1/tracks?ids="+requested.join(",")+"&market=DE");
   if(!Array.isArray(data.tracks)||data.tracks.length!==requested.length||data.tracks.some(t=>t!==null&&(!t||!requested.includes(t.id))))throw new Error("Invalid hydrated repertoire tracks");
   pool.push(...data.tracks.filter(t=>t!==null));
  }
 }
 if(pool.length>1500)throw new Error("Selection track pool exceeds bound");
 return pool;
}

export async function createSelectionPlaylist(input:{
 token:string;spotifyUserId:string;artists:string[];festivals:string[];canonicalArtists:SelectionArtist[];request?:SpotifyRequest;
}) {
 const request=input.request??fetch,names=deduplicateArtists(input.artists).slice(0,250);
 const headers={Authorization:"Bearer "+input.token,"Content-Type":"application/json"};
 const seen=new Set<string>(),artists:SelectionArtist[]=[];
 for(const name of names){
  const matches=input.canonicalArtists.filter(a=>a.requestedName===name);
  const artist=matches.length===1?matches[0]:{requestedName:name,name,slug:null,spotifyId:null};
  if(artist.slug&&seen.has(artist.slug))continue;
  if(artist.slug)seen.add(artist.slug);
  artists.push(artist);
 }
 const pools=[];
 for(const artist of artists)pools.push({...artist,tracks:await selectionPool(artist,request,headers)});
 // The same pure Python safeguards are imported by festival_playlists. No
 // provider calls, tokens, files or service credentials enter this policy RPC.
 const result=await executePlaylistJson(process.env.PLAYLIST_PYTHON??"python3",
  [path.join(process.cwd(),"scripts/spotify_gmm_2026/playlist_worker_rpc.py"),"select-user-tracks"],{artists:pools},
  {cwd:process.cwd(),env:{...process.env,PYTHONDONTWRITEBYTECODE:"1",FESTIVAL_WORKER_STDIO:"1",FESTIVAL_REPORT_ONLY:"1"},signal:AbortSignal.timeout(30_000),timeout:30_000}) as {selected:{artist:string;uri:string}[];unresolved:string[]};
 if(!Array.isArray(result.selected)||!Array.isArray(result.unresolved)||result.selected.some(t=>!/^spotify:track:[A-Za-z0-9]{22}$/.test(t.uri)))throw new Error("Invalid selection policy reply");
 const tracks=result.selected.map(t=>t.uri);
 if(!tracks.length)throw new Error("Spotify could not resolve any selected artists");
 const suffix=input.festivals.length===1?input.festivals[0]:input.festivals.length+" festivals";
 const playlist=await spotifyJson<{id:string;external_urls:{spotify:string}}>(request,"https://api.spotify.com/v1/users/"+encodeURIComponent(input.spotifyUserId)+"/playlists",{
  method:"POST",headers,body:JSON.stringify({name:"Loud Weekend · "+suffix,description:"One verified track per deduplicated artist selected in Loud Weekend ("+artists.length+" artists).",public:false}),
 });
 for(let index=0;index<tracks.length;index+=100)await spotifyJson(request,"https://api.spotify.com/v1/playlists/"+playlist.id+"/tracks",{method:"POST",headers,body:JSON.stringify({uris:tracks.slice(index,index+100)})});
 return{playlistUrl:playlist.external_urls.spotify,playlistId:playlist.id,trackCount:tracks.length,artistCount:artists.length,unresolved:result.unresolved};
}
