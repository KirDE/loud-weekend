import type {Prisma} from '@prisma/client';
export type PlaylistProvider = 'spotify'|'youtube_music';
export function requestedProviders(evidence:Prisma.JsonValue|null):PlaylistProvider[] {
 const values=evidence&&typeof evidence==='object'&&!Array.isArray(evidence)?evidence.providers:undefined;
 if(values===undefined)return ['spotify','youtube_music'];
 if(!Array.isArray(values)||!values.length||values.some(p=>p!=='spotify'&&p!=='youtube_music'))throw Error('Invalid publication provider scope');
 return [...new Set(values)] as PlaylistProvider[];
}
