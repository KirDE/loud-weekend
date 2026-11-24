import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { overviewSourceHost } from "./festival-overviews.ts";

const summary = z.string().trim().min(1).max(1500);
export const overviewObservation = z.strictObject({
  editionId: z.string().min(1),
  festivalSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  editionYear: z.number().int().min(1900).max(9999),
  city: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  organizerHost: z.string().min(1),
  checkedOn: z.iso.date(),
  sourceUrl: z.url(),
  summary: z.strictObject({ en: summary, de: summary, ru: summary }),
});

export type OverviewObservation = z.infer<typeof overviewObservation>;

export async function publishOverviewObservation(
  tx: Prisma.TransactionClient,
  record: OverviewObservation,
) {
  const edition = await tx.festivalEdition.findUniqueOrThrow({
    where: { id: record.editionId },
    include: {
      overview: true,
      festival: { select: { slug: true, city: true, countryCode: true, officialUrl: true } },
    },
  });
  const { festival } = edition;
  if (
    edition.recordState !== "CURRENT" ||
    edition.year !== record.editionYear ||
    festival.slug !== record.festivalSlug ||
    festival.city !== record.city ||
    festival.countryCode !== record.countryCode ||
    overviewSourceHost(festival.officialUrl) !== record.organizerHost ||
    overviewSourceHost(record.sourceUrl) !== record.organizerHost
  ) {
    throw new Error("The city, country and organizer must match the exact catalogue edition");
  }
  const checkedOn = new Date(record.checkedOn + "T00:00:00Z");
  const previous = edition.overview;
  if (previous && previous.checkedOn > checkedOn) {
    throw new Error("The import cannot overwrite a more recently reviewed overview");
  }

  const data = {
    city: record.city,
    countryCode: record.countryCode,
    organizerHost: record.organizerHost,
    checkedOn,
    sourceUrls: [record.sourceUrl],
    summaryEn: record.summary.en,
    summaryDe: record.summary.de,
    summaryRu: record.summary.ru,
  };
  const samePublicContent =
    previous &&
    previous.city === data.city &&
    previous.countryCode === data.countryCode &&
    previous.organizerHost === data.organizerHost &&
    previous.summaryEn === data.summaryEn &&
    previous.summaryDe === data.summaryDe &&
    previous.summaryRu === data.summaryRu &&
    previous.sourceUrls.length === 1 &&
    previous.sourceUrls[0] === record.sourceUrl;
  if (samePublicContent && previous.checkedOn.getTime() === checkedOn.getTime()) return false;

  await tx.editionOverview.upsert({
    where: { editionId: edition.id },
    create: { editionId: edition.id, ...data },
    update: data,
  });
  return !samePublicContent;
}
