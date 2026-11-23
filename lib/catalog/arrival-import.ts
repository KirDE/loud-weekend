import { isDeepStrictEqual } from "node:util";
import { EditionArrivalKind, type Prisma } from "@prisma/client";
import { z } from "zod";
import { arrivalSourceHost } from "./arrival-facts.ts";

const secureUrl = z
  .url()
  .refine((value) => !!arrivalSourceHost(value), "Expected a public HTTPS source URL");
const description = z.string().trim().min(1).max(2000);
export const arrivalObservation = z.strictObject({
  editionId: z.string().min(1),
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

export type ArrivalObservation = z.infer<typeof arrivalObservation>;

/** Called only inside the protected importer resolution transaction. */
export async function publishArrivalObservation(
  tx: Prisma.TransactionClient,
  record: ArrivalObservation,
) {
  const edition = await tx.festivalEdition.findUniqueOrThrow({
    where: { id: record.editionId },
    select: {
      year: true,
      recordState: true,
      festival: { select: { slug: true, officialUrl: true, countryCode: true } },
      arrivalFacts: true,
    },
  });
  if (
    edition.recordState !== "CURRENT" ||
    edition.year !== record.editionYear ||
    edition.festival.slug !== record.festivalSlug ||
    edition.festival.countryCode !== record.countryCode ||
    arrivalSourceHost(edition.festival.officialUrl) !== record.organizerHost ||
    new Set(record.facts.map((fact) => fact.kind)).size !== record.facts.length
  )
    throw new Error("Reviewed arrival edition mismatch");

  let changed = false;
  for (const fact of record.facts) {
    if (arrivalSourceHost(fact.sourceUrl) !== record.organizerHost)
      throw new Error("The primary source must be on the organizer host");
    const checkedOn = new Date(fact.checkedOn + "T00:00:00Z");
    const existing = edition.arrivalFacts.find((row) => row.kind === fact.kind);
    if (existing && existing.checkedOn > checkedOn)
      throw new Error("The import cannot overwrite more recently reviewed guidance");
    const data = {
      editionYear: record.editionYear,
      countryCode: record.countryCode,
      organizerHost: record.organizerHost,
      descriptionEn: fact.description.en,
      descriptionDe: fact.description.de,
      descriptionRu: fact.description.ru,
      sourceUrl: fact.sourceUrl,
      supportingSourceUrl: fact.supportingSourceUrl ?? null,
    };
    if (existing) {
      const { editionId: _editionId, kind: _kind, checkedOn: _checkedOn, ...previous } = existing;
      if (isDeepStrictEqual(previous, data)) continue;
    }
    changed = true;
    await tx.editionArrivalFact.upsert({
      where: { editionId_kind: { editionId: record.editionId, kind: fact.kind } },
      create: { editionId: record.editionId, kind: fact.kind, checkedOn, ...data },
      update: { checkedOn, ...data },
    });
  }
  return changed;
}
