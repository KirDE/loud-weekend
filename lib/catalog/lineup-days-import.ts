import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { timetableEntrySchema } from "../timetables.ts";

const day = timetableEntrySchema.shape.date;
const documentSchema = z.strictObject({
  festivalSlug: z.string().trim().min(1),
  editionYear: z.number().int(),
  startDate: day,
  endDate: day,
  sourceUrl: z.string().max(2000).url(),
  observedAt: z.string().datetime({ offset: true }),
  entries: z
    .array(
      z.strictObject({
        artistSlug: z.string().trim().min(1),
        dates: z.array(day).max(31),
        status: z.enum(["announced", "cancelled"]),
      }),
    )
    .min(1)
    .max(1000),
});

const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

export async function importLineupDays(db: PrismaClient, document: unknown, checkOnly = true) {
  const input = documentSchema.parse(document);
  const source = new URL(input.sourceUrl);
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  ) {
    throw new Error("Use a public HTTPS source URL without credentials, query, or fragment");
  }
  const observedAt = new Date(input.observedAt);
  if (observedAt.getTime() > Date.now()) throw new Error("Observation cannot be in the future");

  return db.$transaction(
    async (tx) => {
      const target = await tx.festivalEdition.findFirstOrThrow({
        where: { year: input.editionYear, festival: { slug: input.festivalSlug } },
        select: { id: true },
      });
      await tx.$queryRaw`SELECT id FROM "FestivalEdition" WHERE id = ${target.id} FOR UPDATE`;
      const edition = await tx.festivalEdition.findUniqueOrThrow({
        where: { id: target.id },
        include: {
          festival: true,
          lineup: { include: { artist: true } },
          lineupDays: { include: { artist: { select: { slug: true } } } },
        },
      });
      if (
        !edition.startDate ||
        !edition.endDate ||
        dateOnly(edition.startDate) !== input.startDate ||
        dateOnly(edition.endDate) !== input.endDate ||
        input.startDate > input.endDate
      ) {
        throw new Error("Reviewed date range must match the selected edition exactly");
      }
      if (source.origin !== new URL(edition.festival.officialUrl).origin) {
        throw new Error("Source must use the festival's official origin");
      }
      const editionArtists = new Map(edition.lineup.map(({ artist }) => [artist.slug, artist.id]));
      const announcedArtistIds = new Set(
        edition.lineup
          .filter(({ status }) => status === "ANNOUNCED")
          .map(({ artistId }) => artistId),
      );
      for (const allocation of edition.lineupDays)
        editionArtists.set(allocation.artist.slug, allocation.artistId);
      const existing = new Map(edition.lineupDays.map((record) => [record.artistId, record]));
      const seen = new Set<string>();
      const changedArtistIds: string[] = [];
      for (const entry of input.entries) {
        const artistId = editionArtists.get(entry.artistSlug);
        if (!artistId || seen.has(artistId))
          throw new Error("Every entry must resolve to a distinct artist in this edition");
        if (entry.status === "announced" && !announcedArtistIds.has(artistId)) {
          throw new Error("An announced allocation requires an announced roster entry");
        }
        seen.add(artistId);
        const dates = [...new Set(entry.dates)].sort();
        if (
          dates.length !== entry.dates.length ||
          dates.some((date) => date < input.startDate || date > input.endDate)
        ) {
          throw new Error("Allocation dates must be distinct and within the selected edition");
        }
        const previous = existing.get(artistId);
        const status = entry.status === "cancelled" ? "CANCELLED" : "ANNOUNCED";
        const allocationContent = {
          dates,
          status,
          startDate: input.startDate,
          endDate: input.endDate,
          sourceUrl: source.href,
        };
        const priorContent = previous
          ? {
              dates: previous.dates.map(dateOnly),
              status: previous.status,
              startDate: dateOnly(previous.startDate),
              endDate: dateOnly(previous.endDate),
              sourceUrl: previous.sourceUrl,
            }
          : null;
        if (previous && JSON.stringify(priorContent) === JSON.stringify(allocationContent)) {
          // Advance the evidence fence without manufacturing a public publication.
          if (!checkOnly && observedAt > previous.observedAt) {
            await tx.editionLineupDayAllocation.update({
              where: { editionId_artistId: { editionId: edition.id, artistId } },
              data: { observedAt },
            });
          }
          continue;
        }
        if (previous && observedAt.getTime() <= previous.observedAt.getTime()) {
          throw new Error("A changed allocation requires a newer official observation");
        }

        changedArtistIds.push(artistId);
        if (checkOnly) continue;
        const allocation = {
          dates: dates.map(toDate),
          status,
          startDate: edition.startDate,
          endDate: edition.endDate,
          sourceUrl: source.href,
          observedAt,
        } as const;
        await tx.editionLineupDayAllocation.upsert({
          where: { editionId_artistId: { editionId: edition.id, artistId } },
          create: { editionId: edition.id, artistId, ...allocation },
          update: allocation,
        });
        await tx.adminAuditEntry.create({
          data: {
            action: "lineup_day_allocation.publish",
            actorLabel: "reviewed-lineup-days-import",
            target: edition.id,
            resourceKey: artistId,
            beforeValue:
              priorContent && previous
                ? { ...priorContent, observedAt: previous.observedAt.toISOString() }
                : undefined,
            afterValue: { ...allocationContent, observedAt: observedAt.toISOString() },
          },
        });
      }
      const changed = changedArtistIds.length;
      if (!checkOnly && changed > 0) {
        await tx.catalogPublication.create({
          data: {
            source: "ADMIN",
            sourceId: `lineup-days:${randomUUID()}`,
            festivalSlug: edition.festival.slug,
            editionYear: edition.year,
            actorLabel: "reviewed-lineup-days-import",
            fields: ["lineupDays"],
            affectedArtistIds: changedArtistIds.sort(),
            evidence: { sourceUrl: source.href, observedAt: observedAt.toISOString(), changed },
          },
        });
      }
      return { checkOnly, changed };
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}
