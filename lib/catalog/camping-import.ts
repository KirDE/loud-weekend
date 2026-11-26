import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { campingSourceHost } from "./camping-facts.ts";

const description = z.string().trim().min(1).max(2000);
export const campingObservation = z.strictObject({
  editionId: z.string().min(1),
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

export type CampingObservation = z.infer<typeof campingObservation>;

export async function publishCampingObservation(
  tx: Prisma.TransactionClient,
  record: CampingObservation,
) {
  if (campingSourceHost(record.sourceUrl) !== record.organizerHost)
    throw new Error("The primary source must be on the organizer's HTTPS host");
  if (new Set(record.facts.map((fact) => fact.field)).size !== record.facts.length)
    throw new Error("Each camping field must appear once per import");

  const edition = await tx.festivalEdition.findUniqueOrThrow({
    where: { id: record.editionId },
    select: {
      year: true,
      recordState: true,
      endDate: true,
      festival: { select: { slug: true, city: true, officialUrl: true, countryCode: true } },
      campingFacts: true,
    },
  });
  if (
    edition.recordState !== "CURRENT" ||
    edition.year !== record.editionYear ||
    edition.festival.slug !== record.festivalSlug ||
    edition.festival.city !== record.city ||
    edition.festival.countryCode !== record.countryCode ||
    campingSourceHost(edition.festival.officialUrl) !== record.organizerHost
  )
    throw new Error(
      "The reviewed city, country and organizer must match the exact catalogue edition",
    );

  const checkedOn = new Date(record.checkedOn + "T00:00:00Z");
  let changed = false;
  for (const fact of record.facts) {
    const earliestDate =
      fact.field === "arrival" ? new Date(fact.earliestDate + "T00:00:00Z") : null;
    if (earliestDate && edition.endDate && earliestDate > edition.endDate)
      throw new Error("Camping arrival cannot be after the end of the reviewed edition");
    const existing = edition.campingFacts.find((row) => row.field === fact.field);
    if (existing && existing.checkedOn > checkedOn)
      throw new Error("The import cannot overwrite more recently reviewed guidance");
    const data = {
      editionYear: record.editionYear,
      city: record.city,
      countryCode: record.countryCode,
      organizerHost: record.organizerHost,
      sourceUrl: record.sourceUrl,
      earliestDate,
      descriptionEn: fact.field === "arrival" ? null : fact.description.en,
      descriptionDe: fact.field === "arrival" ? null : fact.description.de,
      descriptionRu: fact.field === "arrival" ? null : fact.description.ru,
    };
    const where = { editionId_field: { editionId: record.editionId, field: fact.field } };
    if (existing) {
      const {
        editionId: _editionId,
        field: _field,
        checkedOn: previousCheck,
        ...previous
      } = existing;
      if (isDeepStrictEqual(previous, data)) {
        if (previousCheck < checkedOn)
          await tx.editionCampingFact.update({ where, data: { checkedOn } });
        continue;
      }
    }
    changed = true;
    await tx.editionCampingFact.upsert({
      where,
      create: { editionId: record.editionId, field: fact.field, checkedOn, ...data },
      update: { checkedOn, ...data },
    });
  }
  return changed;
}
