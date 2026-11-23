import type { PrismaClient } from "@prisma/client";
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

export async function importReviewedVenue(db: PrismaClient, input: unknown, checkOnly = true) {
  const { festivalSlug, checkedOn: reviewDate, ...location } = reviewedVenue.parse(input);
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
          venue: { select: { editionYear: true, checkedOn: true } },
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

      const checkedOn = new Date(reviewDate + "T00:00:00Z");
      if (
        edition.venue?.editionYear === location.editionYear &&
        edition.venue.checkedOn > checkedOn
      ) {
        throw new Error("The import cannot overwrite a more recently reviewed venue");
      }
      if (!checkOnly) {
        const data = { ...location, checkedOn };
        await tx.editionVenue.upsert({
          where: { editionId: edition.id },
          create: { editionId: edition.id, ...data },
          update: data,
        });
      }
      return { checkOnly, festivalSlug, editionYear: location.editionYear };
    },
    { isolationLevel: "Serializable" },
  );
}
