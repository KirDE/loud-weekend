import { isDeepStrictEqual } from "node:util";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { campingSourceHost } from "./camping-facts.ts";

const description = z.string().trim().min(1).max(2000);
const reviewedCamping = z.strictObject({
  festivalSlug: z.string().min(1),
  editionYear: z.number().int().positive(),
  city: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  organizerHost: z.string().min(1),
  sourceUrl: z.url(),
  checkedOn: z.iso.date(),
  facts: z
    .array(
      z.union([
        z.strictObject({ field: z.literal("arrival"), earliestDate: z.iso.date() }),
        z.strictObject({
          field: z.enum(["camping", "accessibility", "facilities", "motorhomes", "viewing"]),
          description: z.strictObject({ en: description, de: description, ru: description }),
        }),
      ]),
    )
    .min(1),
});

const approvalReceipt = z.strictObject({
  actorLabel: z.string().trim().min(1).max(160),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.iso.datetime(),
});

export async function importReviewedCamping(
  db: PrismaClient,
  input: unknown,
  approvalInput?: unknown,
) {
  const record = reviewedCamping.parse(input);
  const approval = approvalInput === undefined ? undefined : approvalReceipt.parse(approvalInput);
  const checkOnly = approval === undefined;
  if (campingSourceHost(record.sourceUrl) !== record.organizerHost) {
    throw new Error("The primary source must be on the organizer's HTTPS host");
  }
  if (new Set(record.facts.map((fact) => fact.field)).size !== record.facts.length) {
    throw new Error("Each camping field must appear once per import");
  }

  return db.$transaction(
    async (tx) => {
      const edition = await tx.festivalEdition.findFirstOrThrow({
        where: { year: record.editionYear, festival: { slug: record.festivalSlug } },
        select: {
          id: true,
          recordState: true,
          festival: { select: { city: true, officialUrl: true, countryCode: true } },
          campingFacts: true,
        },
      });
      if (edition.recordState === "ARCHIVED") throw new Error("Archived editions are immutable");
      if (
        edition.festival.city !== record.city ||
        edition.festival.countryCode !== record.countryCode ||
        campingSourceHost(edition.festival.officialUrl) !== record.organizerHost
      ) {
        throw new Error(
          "The reviewed city, country and organizer must match the exact catalogue edition",
        );
      }

      const checkedOn = new Date(record.checkedOn + "T00:00:00Z");
      const changed: typeof record.facts = [];
      for (const fact of record.facts) {
        const existing = edition.campingFacts.find(
          (row) => row.field === fact.field && row.editionYear === record.editionYear,
        );
        if (existing && existing.checkedOn > checkedOn) {
          throw new Error("The import cannot overwrite more recently reviewed guidance");
        }
        if (!approval) continue;
        const data = {
          editionYear: record.editionYear,
          city: record.city,
          countryCode: record.countryCode,
          organizerHost: record.organizerHost,
          sourceUrl: record.sourceUrl,
          checkedOn,
          earliestDate:
            fact.field === "arrival" ? new Date(fact.earliestDate + "T00:00:00Z") : null,
          descriptionEn: fact.field === "arrival" ? null : fact.description.en,
          descriptionDe: fact.field === "arrival" ? null : fact.description.de,
          descriptionRu: fact.field === "arrival" ? null : fact.description.ru,
        };
        if (existing) {
          const { editionId: _editionId, field: _field, ...previous } = existing;
          if (isDeepStrictEqual(previous, data)) continue;
        }
        changed.push(fact);
        await tx.editionCampingFact.upsert({
          where: { editionId_field: { editionId: edition.id, field: fact.field } },
          create: { editionId: edition.id, field: fact.field, ...data },
          update: data,
        });
      }
      if (approval && changed.length) {
        await tx.adminAuditEntry.create({
          data: {
            actorLabel: approval.actorLabel,
            action: "FESTIVAL_CAMPING_PUBLICATION",
            resourceKind: "FESTIVAL",
            resourceKey: record.festivalSlug,
            target: edition.id,
            afterValue: { ...record, facts: changed },
            evidence: {
              ...approval,
              sourceUrls: [record.sourceUrl],
              editionYear: record.editionYear,
            },
          },
        });
      }
      return {
        checkOnly,
        festivalSlug: record.festivalSlug,
        editionYear: record.editionYear,
        facts: record.facts.length,
      };
    },
    { isolationLevel: "Serializable" },
  );
}
