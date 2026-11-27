import type { PrismaClient } from "@prisma/client";
import { verifiedSpotifyArtistId } from "../artist-spotify-identity.ts";
import { spotifyRepertoiresForArtists } from "./spotify-repertoire.ts";
import { deduplicateArtists, type SelectionArtist } from "../selection-playlist.ts";

type IdentityRow = {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  identityState: string;
  identities: { provider: string; externalId: string }[];
  links: { source: string; url: string; verified: boolean }[];
};
const key = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en");
export function matchSelectionArtists(rows: IdentityRow[], names: string[]) {
  return names.map((requestedName) => {
    const matches = rows.filter((row) =>
      [row.name, ...row.aliases].some((name) => key(name) === key(requestedName)),
    );
    return { requestedName, artist: matches.length === 1 ? matches[0] : null };
  });
}
/** No fuzzy provider search: ambiguity stays unresolved and binding validation is shared. */
export async function selectionArtists(
  db: Pick<PrismaClient, "artist" | "operationalState">,
  names: string[],
): Promise<SelectionArtist[]> {
  const rows = await db.artist.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      aliases: true,
      identityState: true,
      identities: { select: { provider: true, externalId: true } },
      links: { select: { source: true, url: true, verified: true } },
    },
  });
  const matches = matchSelectionArtists(rows, deduplicateArtists(names));
  const matched = [
    ...new Map(
      matches.flatMap((m) => (m.artist ? [[m.artist.id, m.artist] as const] : [])),
    ).values(),
  ];
  const profiles = await spotifyRepertoiresForArtists(db, matched);
  return matches.map(({ requestedName, artist }) => ({
    requestedName,
    name: artist?.name ?? requestedName,
    slug: artist?.slug ?? null,
    spotifyId: artist ? verifiedSpotifyArtistId(artist) : null,
    ...(artist && profiles[artist.name] ? { repertoire: profiles[artist.name] } : {}),
  }));
}

/** Same canonical/verified identity boundary for both festival discovery entrypoints. */
export async function festivalSpotifyArtists(
  db: Pick<PrismaClient, "artist" | "operationalState">,
  names: string[],
) {
  const artists = await selectionArtists(db, names);
  return {
    aliases: Object.fromEntries(
      artists.filter((a) => a.slug).map((a) => [a.requestedName, a.name]),
    ),
    spotifyArtistIds: Object.fromEntries(
      artists.filter((a) => a.spotifyId).map((a) => [a.requestedName, a.spotifyId]),
    ),
    spotifyRepertoireProfiles: Object.fromEntries(
      artists.filter((a) => a.repertoire).map((a) => [a.requestedName, a.repertoire]),
    ),
  };
}
