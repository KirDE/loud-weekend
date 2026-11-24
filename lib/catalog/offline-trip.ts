import { parseOfflineTrip } from "../../public/offline-trips.mjs";

export async function readPublishedOfflineTrip(slug: string, year: number) {
  const { db } = await import("../db.ts");
  const snapshot = await db.$transaction(
    async (tx) => {
      const edition = await tx.festivalEdition.findFirst({
        where: { festival: { slug }, year, recordState: { in: ["CURRENT", "ARCHIVED"] } },
        select: {
          id: true,
          festival: { select: { name: true, city: true, country: true } },
          startDate: true,
          endDate: true,
          sourceUpdatedAt: true,
        },
      });
      if (!edition) return null;
      const timetable = await tx.timetablePerformance.findMany({
        where: {
          editionId: edition.id,
          date: { gte: edition.startDate ?? undefined, lte: edition.endDate ?? undefined },
          // Older rows without explicit evidence cannot inherit a default zone or checked time.
          timeZone: { not: null },
          sourceUrl: { not: null },
          observedAt: { not: null },
        },
        take: 801,
        orderBy: [{ date: "asc" }, { start: "asc" }, { stage: "asc" }],
        select: {
          date: true,
          start: true,
          stage: true,
          artistName: true,
          timeZone: true,
          status: true,
          observedAt: true,
        },
      });
      return { edition, timetable };
    },
    { isolationLevel: "RepeatableRead" },
  );
  if (!snapshot) return null;
  const { edition, timetable } = snapshot;
  const { name, city, country } = edition.festival;
  const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
  const startDate = date(edition.startDate);
  const endDate = date(edition.endDate);
  const trip = parseOfflineTrip({
    version: 1,
    slug,
    year,
    name,
    location: [city, country].filter(Boolean).join(", ") || null,
    startDate,
    endDate,
    updatedAt: edition.sourceUpdatedAt.toISOString(),
    timetable: timetable.map((entry) => ({
      date: date(entry.date),
      start: entry.start,
      stage: entry.stage,
      artist: entry.artistName,
      timeZone: entry.timeZone,
      status: entry.status === "CANCELLED" ? "cancelled" : "scheduled",
      checkedAt: entry.observedAt?.toISOString(),
    })),
  });
  if (!trip) throw new Error("Invalid public trip data");
  return trip;
}
