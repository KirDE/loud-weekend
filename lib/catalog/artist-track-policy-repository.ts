import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  repertoireEditionSchema,
  spotifyTrackPolicySchema,
  trackPolicyKey,
} from "./spotify-repertoire.ts";

export const artistTrackPolicySubmission = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/),
    policy: spotifyTrackPolicySchema,
    edition: repertoireEditionSchema.optional(),
    actorLabel: z.string().trim().min(1).max(200),
    evidence: z.string().trim().min(1).max(10000),
    sourceUrls: z.array(z.string().url().startsWith("https://")).min(1).max(100),
  })
  .strict();

/** Audited immutable restrictions on an existing artist, not aliases or new identities. */
export async function publishArtistTrackPolicy(db: PrismaClient, input: unknown, apply = false) {
  const value = artistTrackPolicySubmission.parse(input);
  const key = trackPolicyKey(value.slug, value.edition);
  return db.$transaction(
    async (tx) => {
      const artist = await tx.artist.findUnique({
        where: { slug: value.slug },
        select: { id: true },
      });
      if (!artist) throw new Error("Unknown artist slug");
      if (value.edition) {
        const edition = await tx.festivalEdition.findFirst({
          where: {
            festival: { slug: value.edition.festivalSlug },
            year: value.edition.editionYear,
            recordState: "CURRENT",
            lineup: { some: { artistId: artist.id, status: "ANNOUNCED" } },
          },
          select: { id: true },
        });
        if (!edition) throw new Error("Track policy requires announced artist in current edition");
      }
      const existing = await tx.operationalState.findUnique({ where: { key } });
      if (
        existing &&
        JSON.stringify(spotifyTrackPolicySchema.parse(existing.payload)) !==
          JSON.stringify(value.policy)
      )
        throw new Error("Policy conflict; reviewed revision required");
      if (apply && !existing) {
        await tx.operationalState.create({ data: { key, payload: value.policy } });
        await tx.adminAuditEntry.create({
          data: {
            actorLabel: value.actorLabel,
            action: "artist.track-policy.publish",
            resourceKind: "ARTIST",
            resourceKey: value.slug,
            afterValue: value.policy,
            evidence: {
              verification: value.evidence,
              sourceUrls: value.sourceUrls,
              ...(value.edition ? { edition: value.edition } : {}),
            },
          },
        });
      }
      return { key, existing: !!existing, applied: apply && !existing, providerWrites: 0 };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
