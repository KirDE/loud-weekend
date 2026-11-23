import { isDeepStrictEqual } from "node:util";
import { EditionArrivalKind, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { arrivalSourceHost } from "./arrival-facts.ts";

const secureUrl = z
  .url()
  .refine((value) => !!arrivalSourceHost(value), "Expected a public HTTPS source URL");
const description = z.string().trim().min(1).max(2000);
const reviewedArrival = z.strictObject({
  festivalSlug: z.string().min(1),
  editionYear: z.number().int().positive(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  organizerHost: z.string().min(1),
  facts: z
    .array(
      z.strictObject({
        kind: z.enum(EditionArrivalKind),
        description: z.strictObject({ en: description, de: description, ru: description }),
        sourceUrl: secureUrl,
        supportingSourceUrl: secureUrl.optional(),
        checkedOn: z.iso.date(),
      }),
    )
    .min(1),
});

const approvalReceipt = z.strictObject({
  actorLabel: z.string().trim().min(1).max(160),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.iso.datetime(),
});

export async function importReviewedArrival(
  db: PrismaClient,
  input: unknown,
  approvalInput?: unknown,
) {
  const record = reviewedArrival.parse(input);
  const approval = approvalInput === undefined ? undefined : approvalReceipt.parse(approvalInput);
  const checkOnly = approval === undefined;
  if (new Set(record.facts.map((fact) => fact.kind)).size !== record.facts.length) {
    throw new Error("Each arrival fact kind must appear once per import");
  }

  return db.$transaction(
    async (tx) => {
      const edition = await tx.festivalEdition.findFirstOrThrow({
        where: { year: record.editionYear, festival: { slug: record.festivalSlug } },
        select: {
          id: true,
          recordState: true,
          festival: { select: { officialUrl: true, countryCode: true } },
          arrivalFacts: true,
        },
      });
      if (edition.recordState === "ARCHIVED") throw new Error("Archived editions are immutable");
      if (
        edition.festival.countryCode !== record.countryCode ||
        arrivalSourceHost(edition.festival.officialUrl) !== record.organizerHost
      ) {
        throw new Error(
          "The reviewed organizer and country must match the exact catalogue edition",
        );
      }

      const changed: typeof record.facts = [];
      for (const fact of record.facts) {
        if (arrivalSourceHost(fact.sourceUrl) !== record.organizerHost) {
          throw new Error("The primary source must be on the organizer host");
        }
        const checkedOn = new Date(fact.checkedOn + "T00:00:00Z");
        const existing = edition.arrivalFacts.find(
          (row) => row.kind === fact.kind && row.editionYear === record.editionYear,
        );
        if (existing && existing.checkedOn > checkedOn) {
          throw new Error("The import cannot overwrite more recently reviewed guidance");
        }
        if (!approval) continue;
        const data = {
          editionYear: record.editionYear,
          countryCode: record.countryCode,
          organizerHost: record.organizerHost,
          descriptionEn: fact.description.en,
          descriptionDe: fact.description.de,
          descriptionRu: fact.description.ru,
          sourceUrl: fact.sourceUrl,
          supportingSourceUrl: fact.supportingSourceUrl ?? null,
          checkedOn,
        };
        if (existing) {
          const { editionId: _editionId, kind: _kind, ...previous } = existing;
          if (isDeepStrictEqual(previous, data)) continue;
        }
        changed.push(fact);
        await tx.editionArrivalFact.upsert({
          where: { editionId_kind: { editionId: edition.id, kind: fact.kind } },
          create: { editionId: edition.id, kind: fact.kind, ...data },
          update: data,
        });
      }
      if (approval && changed.length) {
        await tx.adminAuditEntry.create({
          data: {
            actorLabel: approval.actorLabel,
            action: "FESTIVAL_ARRIVAL_PUBLICATION",
            resourceKind: "FESTIVAL",
            resourceKey: record.festivalSlug,
            target: edition.id,
            afterValue: { ...record, facts: changed },
            evidence: {
              ...approval,
              sourceUrls: [
                ...new Set(
                  record.facts.flatMap((fact) =>
                    fact.supportingSourceUrl
                      ? [fact.sourceUrl, fact.supportingSourceUrl]
                      : [fact.sourceUrl],
                  ),
                ),
              ],
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
