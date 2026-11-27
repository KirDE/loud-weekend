import { createHash } from "node:crypto";
import { db } from "../lib/db.ts";
import {
  repertoireBindingKey,
  repertoireEditionSchema,
  repertoireScopeKey,
  REPERTOIRE_PROFILE_PREFIX,
  spotifyRepertoireSchema,
} from "../lib/catalog/spotify-repertoire.ts";

// Private stdin configuration; no catalogue identities, plans or providers changed.
const args = process.argv.slice(2);
const options = new Map<string, string | true>();
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!["--apply", "--festival", "--year"].includes(arg) || options.has(arg))
    throw new Error("Unknown or duplicate repertoire option");
  if (arg === "--apply") options.set(arg, true);
  else {
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("Repertoire option requires a value");
    options.set(arg, value);
  }
}
const scoped = options.has("--festival") || options.has("--year");
const edition = scoped
  ? repertoireEditionSchema.parse({
      festivalSlug: options.get("--festival"),
      editionYear: Number(options.get("--year")),
    })
  : undefined;
const apply = options.has("--apply");
const parts: Buffer[] = [];
let size = 0;
for await (const part of process.stdin) {
  size += part.length;
  if (size > 64 * 1024) throw new Error("Repertoire configuration too large");
  parts.push(part);
}
try {
  const profile = spotifyRepertoireSchema.parse(JSON.parse(Buffer.concat(parts).toString("utf8")));
  const profileKey = REPERTOIRE_PROFILE_PREFIX + profile.key;
  const hash = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
  const result = await db.$transaction(
    async (tx) => {
      const artists = await tx.artist.findMany({
        where: { slug: { in: profile.artistSlugs } },
        select: { id: true, slug: true, name: true },
      });
      if (artists.length !== profile.artistSlugs.length)
        throw new Error("All repertoire acts must already exist");
      if (edition) {
        const row = await tx.festivalEdition.findFirst({
          where: {
            festival: { slug: edition.festivalSlug },
            year: edition.editionYear,
            recordState: "CURRENT",
          },
          select: { lineup: { where: { status: "ANNOUNCED" }, select: { artistId: true } } },
        });
        if (!row || artists.some((a) => !row.lineup.some((entry) => entry.artistId === a.id)))
          throw new Error("Scoped repertoire requires announced acts in the current edition");
      }
      const existing = await tx.operationalState.findUnique({ where: { key: profileKey } });
      if (
        existing &&
        JSON.stringify(spotifyRepertoireSchema.parse(existing.payload)) !== JSON.stringify(profile)
      )
        throw new Error(
          "Existing profile differs; create a reviewed revision, do not overwrite in place",
        );
      for (const artist of artists) {
        const binding = await tx.operationalState.findUnique({
          where: { key: repertoireBindingKey(artist.slug, edition) },
        });
        if (
          binding &&
          JSON.stringify(binding.payload) !== JSON.stringify({ profileKey: profile.key })
        )
          throw new Error("Artist already has a different repertoire binding");
      }
      if (apply) {
        if (!existing)
          await tx.operationalState.create({ data: { key: profileKey, payload: profile } });
        for (const artist of artists)
          await tx.operationalState.upsert({
            where: { key: repertoireBindingKey(artist.slug, edition) },
            create: {
              key: repertoireBindingKey(artist.slug, edition),
              payload: { profileKey: profile.key },
            },
            update: {},
          });
        const auditKey = edition
          ? "spotify-repertoire-edition-audit:" + repertoireScopeKey(edition) + profile.key
          : "spotify-repertoire-audit:" + profile.key;
        await tx.operationalState.upsert({
          where: { key: auditKey },
          create: {
            key: auditKey,
            payload: {
              schemaVersion: 1,
              profileKey,
              profileHash: hash,
              artistSlugs: profile.artistSlugs,
              sourceUrls: profile.sourceUrls,
              ...(edition ? { edition } : {}),
              configuredAt: new Date().toISOString(),
              providerWrites: 0,
            },
          },
          update: {},
        });
      }
      return {
        profileKey,
        hash,
        artists,
        apply,
        ...(edition ? { edition } : {}),
        existing: Boolean(existing),
        providerWrites: 0,
      };
    },
    { isolationLevel: "Serializable" },
  );
  console.log(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
