import { parseOfflineTrip } from "../../public/offline-trips.mjs";
import { offlineTimetableSelect, offlineTimetableWhere, projectOfflinePerformance } from "./offline-timetable.ts";

export async function readPublishedOfflineTrip(slug: string, year: number) {
  const { db } = await import("../db.ts");
  const edition = await db.festivalEdition.findFirst({
    where: { festival: { slug }, year, recordState: { in: ["CURRENT", "ARCHIVED"] } },
    select: {
      festival: { select: { name: true, city: true, country: true } },
      startDate: true, endDate: true, sourceUpdatedAt: true,
      timetable: {
        // Older rows without explicit schedule evidence must not inherit a default time zone or checked time.
        where: offlineTimetableWhere,
        take: 801,
        orderBy: [{ date: "asc" }, { start: "asc" }, { stage: "asc" }],
        select: offlineTimetableSelect,
      },
    },
  });
  if (!edition) return null;
  const { name, city, country } = edition.festival;
  const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
  const trip = parseOfflineTrip({
    version: 1, slug, year, name, location: [city, country].filter(Boolean).join(", ") || null,
    startDate: date(edition.startDate), endDate: date(edition.endDate), updatedAt: edition.sourceUpdatedAt.toISOString(),
    timetable: edition.timetable.flatMap(projectOfflinePerformance),
  });
  if (!trip) throw new Error("Invalid public trip data");
  return trip;
}
