import { Prisma, SyncKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { spotifyAccessToken, spotifyEndpoints } from "@/lib/spotify";
import { rejectUntrustedOrigin } from "@/lib/request-origin";
import { collectionsForImport, readCollections } from "@/lib/collections";

const input=z.object({revision:z.number().int().nonnegative()}).strict();
const pageSchema=z.object({
 items:z.array(z.object({
  id:z.string(),name:z.string(),external_urls:z.object({spotify:z.string()}),
  images:z.array(z.object({url:z.string()})),owner:z.object({id:z.string(),display_name:z.string().nullable()}),
  tracks:z.object({total:z.number().int().nonnegative()}),
 })).max(50),next:z.string().url().nullable(),
});
class ImportConflict extends Error {}
export async function POST(request:Request) {
 const originError=rejectUntrustedOrigin(request);if(originError)return originError;
 const user=await requireUser();if(!user)return error("Authentication required.",401);
 const connection=await db.spotifyConnection.findUnique({where:{userId:user.id}});
 if(!connection)return error("Connect Spotify first.",409);
 const parsed=input.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return error("Collections revision is required.",400);
 const previous=await db.syncDocument.findUnique({where:{userId_kind:{userId:user.id,kind:SyncKind.COLLECTIONS}}});
 if((previous?.revision??0)!==parsed.data.revision)return error("Sync conflict. Fetch the latest document.",409);
 try {
  // Validate legacy/versioned data before any provider work; unsupported data is not discarded.
  readCollections(previous?.payload);
  const token=await spotifyAccessToken(connection.encryptedRefreshToken),api=spotifyEndpoints().api;
  const endpoint=new URL(api+"/v1/me/playlists");
  let next:string|null=endpoint.href+"?limit=50";
  const visited=new Set<string>(),playlists:z.infer<typeof pageSchema>["items"]=[];
  while(next) {
   const url=new URL(next);
   if(url.origin!==endpoint.origin||url.pathname!==endpoint.pathname||url.username||url.password||url.hash||visited.has(url.href)||visited.size>=10)
    throw new Error("Unexpected Spotify pagination");
   visited.add(url.href);
   const response=await fetch(url.href,{headers:{Authorization:"Bearer "+token},cache:"no-store"});
   if(!response.ok)throw new Error("Spotify playlist lookup failed");
   const page=pageSchema.parse(await response.json());
   playlists.push(...page.items);if(playlists.length>500)throw new Error("Spotify import exceeds bounded collection size");
   next=page.next;
  }
  const syncedAt=new Date().toISOString();
  const payload=collectionsForImport(previous?.payload,{syncedAt,playlists:playlists.map(item=>({
   id:item.id,name:item.name,url:item.external_urls.spotify,image:item.images[0]?.url??null,
   owner:item.owner.display_name??item.owner.id,trackCount:item.tracks.total,
  }))}) as Prisma.InputJsonValue;
  const document=await db.$transaction(async tx=>{
   let id:string;
   if(previous) {
    const updated=await tx.syncDocument.updateMany({where:{id:previous.id,revision:parsed.data.revision},data:{payload,revision:{increment:1}}});
    if(!updated.count)throw new ImportConflict();
    id=previous.id;
   } else id=(await tx.syncDocument.create({data:{userId:user.id,kind:SyncKind.COLLECTIONS,payload}})).id;
   await tx.spotifyConnection.update({where:{id:connection.id},data:{lastSyncedAt:new Date(syncedAt)}});
   return tx.syncDocument.findUniqueOrThrow({where:{id}});
  });
  return Response.json({document});
 } catch(cause) {
  if(cause instanceof ImportConflict||(cause instanceof Prisma.PrismaClientKnownRequestError&&cause.code==="P2002"))
   return error("Sync conflict. Fetch the latest document.",409);
  return error("Spotify synchronization failed. Previous collections were preserved.",502);
 }
}
