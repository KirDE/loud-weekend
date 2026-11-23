import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { overviewSourceHost } from "./festival-overviews.ts";

const summary = z.string().trim().min(1).max(1500);
const reviewedOverview = z.strictObject({
  festivalSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  editionYear: z.number().int().min(1900).max(9999),
  city: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  organizerHost: z.string().min(1),
  checkedOn: z.iso.date(),
  sources: z.array(z.url()).min(1).max(5),
  summary: z.strictObject({ en: summary, de: summary, ru: summary }),
});

export async function importReviewedOverview(db: PrismaClient, input: unknown, checkOnly = true) {
  const record = reviewedOverview.parse(input);
  if (
    record.sources.some((url) => overviewSourceHost(url) !== record.organizerHost) ||
    new Set(record.sources).size !== record.sources.length
  ) {
    throw new Error("Sources must be distinct public HTTPS URLs on the organizer host");
  }
  const checkedOn = new Date(record.checkedOn + "T00:00:00Z");

  return db.$transaction(
    async (tx) => {
      const edition = await tx.festivalEdition.findFirstOrThrow({
        where: { year: record.editionYear, festival: { slug: record.festivalSlug } },
        select: {
          id: true,
          recordState: true,
          overview: { select: { checkedOn: true } },
          festival: { select: { city: true, countryCode: true, officialUrl: true } },
        },
      });
      if (edition.recordState === "ARCHIVED") throw new Error("Archived editions are immutable");
      const { city, countryCode, officialUrl } = edition.festival;
      if (
        city !== record.city ||
        countryCode !== record.countryCode ||
        overviewSourceHost(officialUrl) !== record.organizerHost
      ) {
        throw new Error("The city, country and organizer must match the exact catalogue edition");
      }
      if (edition.overview && edition.overview.checkedOn > checkedOn) {
        throw new Error("The import cannot overwrite a more recently reviewed overview");
      }

      if (!checkOnly) {
        const data = {
          city,
          countryCode,
          organizerHost: record.organizerHost,
          checkedOn,
          sourceUrls: record.sources,
          summaryEn: record.summary.en,
          summaryDe: record.summary.de,
          summaryRu: record.summary.ru,
        };
        await tx.editionOverview.upsert({
          where: { editionId: edition.id },
          create: { editionId: edition.id, ...data },
          update: data,
        });
      }
      return { checkOnly, festivalSlug: record.festivalSlug, editionYear: record.editionYear };
    },
    { isolationLevel: "Serializable" },
  );
}
