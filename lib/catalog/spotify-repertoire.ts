import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

export const REPERTOIRE_PROFILE_PREFIX = "spotify-repertoire-profile:";
export const REPERTOIRE_BINDING_PREFIX = "spotify-repertoire-binding:";
export const repertoireEditionSchema = z
  .object({
    festivalSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/),
    editionYear: z.number().int().min(1000).max(9999),
  })
  .strict();
export type RepertoireEdition = z.infer<typeof repertoireEditionSchema>;

export function repertoireScopeKey(edition: RepertoireEdition) {
  const value = repertoireEditionSchema.parse(edition);
  return `${value.festivalSlug}:${value.editionYear}:`;
}
export function repertoireBindingKey(slug: string, edition?: RepertoireEdition) {
  return edition
    ? "spotify-repertoire-edition-binding:" + repertoireScopeKey(edition) + slug
    : REPERTOIRE_BINDING_PREFIX + slug;
}
const id = z.string().regex(/^[A-Za-z0-9]{22}$/);
const unique = (values: string[]) => new Set(values).size === values.length;
export const spotifyRepertoireSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,95}$/),
    artistSlugs: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/))
      .min(1)
      .max(20)
      .refine(unique),
    setlistArtist: z.string().trim().min(1).max(200),
    searchArtists: z
      .array(z.object({ id, name: z.string().trim().min(1).max(200) }).strict())
      .min(1)
      .max(8)
      .refine((values) => unique(values.map((v) => v.id))),
    anchorArtistIds: z.array(id).min(1).max(8).refine(unique),
    collaborationArtistIds: z.array(id).min(0).max(8).refine(unique),
    albumIds: z.array(id).min(1).max(24).refine(unique),
    sourceUrls: z.array(z.string().url().startsWith("https://")).min(1).max(100),
  })
  .strict()
  .refine(
    (profile) =>
      profile.collaborationArtistIds.length > 0 ||
      (profile.searchArtists.length === 1 && profile.anchorArtistIds.length === 1),
    "Repertoire without collaborators requires exactly one search artist and anchor",
  )
  .refine((profile) => {
    const ids = new Set(profile.searchArtists.map((a) => a.id));
    return (
      profile.anchorArtistIds.every((value) => ids.has(value)) &&
      profile.collaborationArtistIds.every(
        (value) => ids.has(value) && !profile.anchorArtistIds.includes(value),
      )
    );
  }, "Repertoire anchor/collaboration IDs must be distinct reviewed search identities");

export type SpotifyRepertoireProfile = z.infer<typeof spotifyRepertoireSchema>;

/** Provider selection policy is not an equivalence between artist identities. */
export async function spotifyRepertoiresForArtists(
  db: Pick<PrismaClient, "operationalState">,
  artists: { slug: string; name: string }[],
  edition?: RepertoireEdition,
): Promise<Record<string, SpotifyRepertoireProfile>> {
  if (!artists.length) return {};
  const rowsByBinding = await db.operationalState.findMany({
    where: {
      key: {
        in: artists.flatMap((a) => [
          repertoireBindingKey(a.slug),
          ...(edition ? [repertoireBindingKey(a.slug, edition)] : []),
        ]),
      },
    },
  });
  // Only the explicit edition can override its global policy; never leak it to
  // another edition or a context-free personal selection. Broken overrides fail closed.
  const bindings = artists.flatMap((artist) => {
    const row =
      (edition &&
        rowsByBinding.find((r) => r.key === repertoireBindingKey(artist.slug, edition))) ||
      rowsByBinding.find((r) => r.key === repertoireBindingKey(artist.slug));
    return row ? [{ ...row, artist }] : [];
  });
  const keys = bindings.map((row) => {
    const binding = z
      .object({ profileKey: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,95}$/) })
      .strict()
      .parse(row.payload);
    return REPERTOIRE_PROFILE_PREFIX + binding.profileKey;
  });
  if (!keys.length) return {};
  const rows = await db.operationalState.findMany({ where: { key: { in: [...new Set(keys)] } } });
  const profiles = new Map(
    rows.map((row) => {
      const profile = spotifyRepertoireSchema.parse(row.payload);
      if (row.key !== REPERTOIRE_PROFILE_PREFIX + profile.key)
        throw new Error("Repertoire profile key mismatch");
      return [row.key, profile];
    }),
  );
  const result: Record<string, SpotifyRepertoireProfile> = {};
  for (let i = 0; i < bindings.length; i++) {
    const profile = profiles.get(keys[i]);
    const artist = bindings[i].artist;
    if (!profile || !artist || !profile.artistSlugs.includes(artist.slug))
      throw new Error("Missing or mismatched repertoire binding");
    if (Object.hasOwn(result, artist.name)) throw new Error("Ambiguous repertoire artist name");
    result[artist.name] = profile;
  }
  return result;
}

// Orthogonal selection restrictions, resolved through the SAME canonical artist
// and edition context as aliases/identities/repertoire. Never a name resolver.
export const spotifyTrackPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    excluded: z.boolean(),
    strictPrimary: z.boolean().optional(),
    reviewedOriginal: z.boolean(),
    blockedPrimaryNames: z.array(z.string().trim().min(1).max(200)).max(100),
    blockedVersionHints: z.array(z.string().trim().min(1).max(200)).max(100),
  })
  .strict();
export type SpotifyTrackPolicy = z.infer<typeof spotifyTrackPolicySchema>;
export function trackPolicyKey(slug: string, edition?: RepertoireEdition) {
  return edition
    ? "spotify-track-policy-edition:" + repertoireScopeKey(edition) + slug
    : "spotify-track-policy:" + slug;
}
export async function spotifyTrackPoliciesForArtists(
  db: Pick<PrismaClient, "operationalState">,
  artists: { slug: string; name: string }[],
  edition?: RepertoireEdition,
): Promise<Record<string, SpotifyTrackPolicy>> {
  if (!artists.length) return {};
  const rows = await db.operationalState.findMany({
    where: {
      key: {
        in: artists.flatMap((a) => [
          trackPolicyKey(a.slug),
          ...(edition ? [trackPolicyKey(a.slug, edition)] : []),
        ]),
      },
    },
  });
  const result: Record<string, SpotifyTrackPolicy> = {};
  for (const artist of artists) {
    const row =
      (edition && rows.find((r) => r.key === trackPolicyKey(artist.slug, edition))) ||
      rows.find((r) => r.key === trackPolicyKey(artist.slug));
    if (!row) continue;
    if (Object.hasOwn(result, artist.name)) throw new Error("Ambiguous track policy artist name");
    result[artist.name] = spotifyTrackPolicySchema.parse(row.payload);
  }
  return result;
}

// A structural cutover gate: no artist names or historical policy facts live here.
export const TRACK_POLICY_MIGRATION_KEY = "spotify-track-policy-migration:v1";
export const trackPolicyMigrationSchema = z
  .object({ schemaVersion: z.literal(1), ready: z.literal(true) })
  .strict();
export async function requireTrackPolicyMigration(db: Pick<PrismaClient, "operationalState">) {
  const rows = await db.operationalState.findMany({ where: { key: TRACK_POLICY_MIGRATION_KEY } });
  const row = rows.find((value) => value.key === TRACK_POLICY_MIGRATION_KEY);
  if (!row || !trackPolicyMigrationSchema.safeParse(row.payload).success)
    throw new Error(
      "Artist track policy migration has not been verified; new discovery is blocked",
    );
}
