import type { PrismaClient } from "@prisma/client";
import { parseOfflineTrip } from "../../public/offline-trips.mjs";
import { offlineTimetableSelect, offlineTimetableWhere, projectOfflinePerformance } from "./offline-timetable.ts";

const maximumScheduleRows = 800;

export async function readPublishedOfflineTrip(slug: string, year: number, database?: Pick<PrismaClient, "festivalEdition">) {
  const db = database ?? (await import("../db.ts")).db;
  const edition = await db.festivalEdition.findFirst({
    where: { festival: { slug }, year, recordState: { in: ["CURRENT", "ARCHIVED"] } },
    select: {
      festival: { select: { name: true, city: true, country: true } },
      startDate: true, endDate: true, sourceUpdatedAt: true,
      timetable: {
        // Older rows without explicit schedule evidence must not inherit a default time zone or checked time.
        where: offlineTimetableWhere(),
        take: maximumScheduleRows + 1,
        orderBy: [{ date: "asc" }, { start: "asc" }, { stage: "asc" }],
        select: offlineTimetableSelect,
      },
    },
  });
  if (!edition) return null;
  // A saturated query may have omitted valid performances after the sentinel.
  if (edition.timetable.length > maximumScheduleRows) throw new Error("Public trip timetable exceeds the download limit");
  const { name, city, country } = edition.festival;
  const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
  const trip = parseOfflineTrip({
    version: 1, slug, year, name, location: [city, country].filter(Boolean).join(", ") || null,
    startDate: date(edition.startDate), endDate: date(edition.endDate), updatedAt: edition.sourceUpdatedAt.toISOString(),
    timetable: edition.timetable.flatMap(performance => projectOfflinePerformance(performance, edition)),
  });
  if (!trip) throw new Error("Invalid public trip data");
  return trip;
}
