import { z } from "zod";

const names = z.array(z.string().trim().min(1).max(200)).max(1000);
const instant = z.string().datetime({ offset: true });
const playlist = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9]{1,100}$/),
    name: z.string().min(1).max(500),
    url: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.origin === "https://open.spotify.com" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            /^\/playlist\/[A-Za-z0-9]{1,100}$/.test(url.pathname)
          );
        } catch {
          return false;
        }
      }),
    image: z.string().url().nullable(),
    owner: z.string().max(500),
    trackCount: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => new URL(value.url).pathname === "/playlist/" + value.id);
const imported = z
  .object({
    syncedAt: instant,
    playlists: z
      .array(playlist)
      .max(500)
      .refine((items) => new Set(items.map((p) => p.id)).size === items.length),
  })
  .strict();
export const collectionsSchema = z
  .object({ schemaVersion: z.literal(1), playlistFestivals: names, spotify: imported.nullable() })
  .strict();
export type CollectionsDocument = z.infer<typeof collectionsSchema>;
export type ImportedSpotifyCollections = NonNullable<CollectionsDocument["spotify"]>;
const legacy = z
  .object({
    playlistFestivals: names.optional(),
    source: z.literal("spotify").optional(),
    syncedAt: instant.optional(),
    playlists: z.array(playlist).max(500).optional(),
  })
  .strict();

/** Pure migration: retain both known legacy namespaces; never invent a check time. */
export function readCollections(value: unknown): CollectionsDocument {
  if (value === null || value === undefined)
    return { schemaVersion: 1, playlistFestivals: [], spotify: null };
  if (typeof value === "object" && "schemaVersion" in value) return collectionsSchema.parse(value);
  const previous = legacy.parse(value);
  const hasImport =
    previous.source === "spotify" ||
    previous.playlists !== undefined ||
    previous.syncedAt !== undefined;
  if (hasImport && (!previous.syncedAt || !previous.playlists))
    throw new Error("Incomplete legacy Spotify import");
  return collectionsSchema.parse({
    schemaVersion: 1,
    playlistFestivals: [...new Set(previous.playlistFestivals ?? [])],
    spotify: hasImport ? { syncedAt: previous.syncedAt, playlists: previous.playlists } : null,
  });
}
/** Device sync owns only the local selection. It cannot overwrite provider imports. */
export function collectionsForSelection(
  previous: unknown,
  selection: unknown,
): CollectionsDocument {
  const remote = readCollections(previous),
    local = readCollections(selection);
  return { ...remote, playlistFestivals: [...new Set(local.playlistFestivals)] };
}
export function mergeCollections(previous: unknown, local: unknown): CollectionsDocument {
  const remote = readCollections(previous),
    selection = readCollections(local);
  return {
    ...remote,
    playlistFestivals: [...new Set([...remote.playlistFestivals, ...selection.playlistFestivals])],
  };
}
export function collectionsForImport(previous: unknown, value: unknown): CollectionsDocument {
  return { ...readCollections(previous), spotify: imported.parse(value) };
}
