import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createIngestionRun } from "../ingestion/repository.ts";
import { INGESTION_SCHEMA_VERSION } from "../ingestion/types.ts";
import { createPublication } from "./publication.ts";
import { z } from "zod";
import { sameVenueCity, venueSourceHost } from "./festival-venues.ts";

const reviewedVenue = z.strictObject({
  festivalSlug: z.string().min(1),
  editionYear: z.number().int().positive(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  organizerHost: z.string().min(1),
  city: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  sourceUrl: z.url(),
  checkedOn: z.iso.date(),
  latitude: z.number().min(-85.051129).max(85.051129),
  longitude: z.number().min(-180).max(180),
});

type VenueReview = { candidateId: string; fingerprint: string; actor: string };
const venueField = "venue";
const adapter = "organizer-venue-v1";

export async function importReviewedVenue(
  db: PrismaClient,
  input: unknown,
  observedAt: Date,
  approval?: VenueReview,
) {
  const record = reviewedVenue.parse(input);
  const { festivalSlug, checkedOn: _, ...location } = record;
  const fingerprint = createHash("sha256").update(JSON.stringify(location)).digest("hex");
  if (approval && approval.fingerprint !== fingerprint)
    throw new Error("Organizer venue evidence changed since preview");
  if (venueSourceHost(location.sourceUrl) !== location.organizerHost) {
    throw new Error("The primary source must be on the organizer's HTTPS host");
  }
  return db.$transaction(
    async (tx) => {
      const edition = await tx.festivalEdition.findFirstOrThrow({
        where: { year: location.editionYear, festival: { slug: festivalSlug } },
        select: {
          id: true,
          recordState: true,
          festival: { select: { officialUrl: true, city: true, countryCode: true } },
        },
      });
      if (edition.recordState === "ARCHIVED") throw new Error("Archived editions are immutable");
      if (
        !sameVenueCity(edition.festival.city ?? undefined, location.city) ||
        edition.festival.countryCode !== location.countryCode ||
        venueSourceHost(edition.festival.officialUrl) !== location.organizerHost
      ) {
        throw new Error(
          "The reviewed city, country and organizer must match the exact catalogue edition",
        );
      }

      const previous = await tx.catalogPublication.findFirst({
        where: { festivalSlug, editionYear: location.editionYear, fields: { has: venueField } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (!approval) {
        const run = await createIngestionRun(tx, {
          trigger: "MANUAL",
          sourceCommit: process.env.APP_SOURCE_COMMIT ?? "manual-venue",
          totalSources: 1,
        });
        const attempt = await tx.ingestionAttempt.create({
          data: {
            runId: run.id,
            festivalSlug,
            requestedUrl: location.sourceUrl,
            finalUrl: location.sourceUrl,
            httpStatus: 200,
            durationMs: Date.now() - observedAt.getTime(),
            parserVersions: { venue: adapter },
            status: "REVIEW",
            startedAt: observedAt,
            endedAt: new Date(),
          },
        });
        const candidate = await tx.ingestionCandidate.create({
          data: {
            runId: run.id,
            attemptId: attempt.id,
            festivalSlug,
            schemaVersion: INGESTION_SCHEMA_VERSION,
            sourceYear: location.editionYear,
            normalized: { editionId: edition.id, previousPublicationId: previous?.id ?? null },
            warnings: [],
            publishable: false,
            evidence: {
              create: {
                field: venueField,
                observedValue: location,
                sourceUrl: location.sourceUrl,
                contentHash: fingerprint,
                observedAt,
                adapter,
              },
            },
          },
          select: { id: true },
        });
        await tx.ingestionRun.update({
          where: { id: run.id },
          data: { status: "COMPLETED", endedAt: new Date(), successful: 1, reviewRequired: 1 },
        });
        return { ...record, checkOnly: true, candidateId: candidate.id, fingerprint };
      }

      const candidate = await tx.ingestionCandidate.findUnique({
        where: { id: approval.candidateId },
        include: { evidence: true },
      });
      const scope = z
        .strictObject({
          editionId: z.string(),
          previousPublicationId: z.string().nullable(),
        })
        .safeParse(candidate?.normalized);
      const proof = candidate?.evidence[0];
      if (
        !candidate ||
        candidate.festivalSlug !== festivalSlug ||
        candidate.sourceYear !== location.editionYear ||
        !scope.success ||
        scope.data.editionId !== edition.id ||
        candidate.evidence.length !== 1 ||
        proof?.field !== venueField ||
        proof.adapter !== adapter ||
        proof.sourceUrl !== location.sourceUrl ||
        proof.contentHash !== fingerprint
      ) {
        throw new Error("No exact persisted venue observation for this approval");
      }
      const stored = approvedVenueObservation(proof.observedValue, festivalSlug, record.checkedOn);
      if (createHash("sha256").update(JSON.stringify(stored)).digest("hex") !== fingerprint)
        throw new Error("Persisted venue observation does not match the approved evidence");

      const receipt = { ...record, checkOnly: false, candidateId: candidate.id, fingerprint };
      if (candidate.reviewState === "PUBLISHED" || candidate.reviewState === "APPROVED")
        return receipt;
      if (
        candidate.reviewState !== "PENDING" ||
        scope.data.previousPublicationId !== (previous?.id ?? null)
      )
        throw new Error("The reviewed venue was superseded; stage the current observation again");

      const now = new Date();
      const checkedOn = new Date(proof.observedAt.toISOString().slice(0, 10));
      const matchingVenue = { editionId: edition.id, ...stored };
      if (await tx.editionVenue.findFirst({ where: matchingVenue, select: { editionId: true } })) {
        await tx.editionVenue.updateMany({
          where: { ...matchingVenue, checkedOn: { lt: checkedOn } },
          data: { checkedOn },
        });
        await tx.ingestionCandidate.update({
          where: { id: candidate.id },
          data: { reviewState: "APPROVED", reviewActor: approval.actor, reviewedAt: now },
        });
        return receipt;
      }

      const publication = await createPublication(tx, {
        source: "INGESTION",
        sourceId: `ingestion:${candidate.id}`,
        actorLabel: approval.actor,
        festivalSlug,
        editionYear: location.editionYear,
        fields: [venueField],
        evidence: {
          candidateId: candidate.id,
          evidenceIds: [proof.id],
          fingerprint,
          sourceUrl: proof.sourceUrl,
        },
      });
      if (!publication) throw new Error("Venue publication was not recorded");
      const data = { ...stored, checkedOn };
      await tx.editionVenue.upsert({
        where: { editionId: edition.id },
        create: { editionId: edition.id, ...data },
        update: data,
      });
      await tx.ingestionCandidate.update({
        where: { id: candidate.id },
        data: {
          reviewState: "PUBLISHED",
          reviewActor: approval.actor,
          reviewedAt: now,
          publishedAt: now,
          catalogueVersion: publication.id,
        },
      });
      return receipt;
    },
    { isolationLevel: "Serializable" },
  );
}

function approvedVenueObservation(value: unknown, festivalSlug: string, checkedOn: string) {
  const {
    festivalSlug: _,
    checkedOn: _date,
    ...location
  } = reviewedVenue.parse({
    ...(value as object),
    festivalSlug,
    checkedOn,
  });
  return location;
}
