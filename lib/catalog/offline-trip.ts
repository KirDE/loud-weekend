import type { Prisma } from "@prisma/client";
import {
  offlineTimetableSelect,
  offlineTimetableWhere,
  projectOfflinePerformance,
} from "./offline-timetable.ts";
import { parseOfflineTrip } from "../../public/offline-trips.mjs";

const maximumScheduleRows = 800;

async function readSnapshot(tx: Prisma.TransactionClient, slug: string, year: number) {
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
      ...offlineTimetableWhere,
    },
    take: maximumScheduleRows + 1,
    orderBy: [{ date: "asc" }, { start: "asc" }, { stage: "asc" }],
    select: offlineTimetableSelect,
  });
  return { edition, timetable };
}

export async function readPublishedOfflineTrip(
  slug: string,
  year: number,
  tx?: Prisma.TransactionClient,
) {
  const snapshot = tx
    ? await readSnapshot(tx, slug, year)
    : await (
        await import("../db.ts")
      ).db.$transaction((snapshotTx) => readSnapshot(snapshotTx, slug, year), {
        isolationLevel: "RepeatableRead",
      });
  if (!snapshot) return null;
  const { edition, timetable } = snapshot;
  // Do not present the first page of a saturated query as a complete schedule.
  if (timetable.length > maximumScheduleRows)
    throw new Error("Public trip timetable exceeds the download limit");
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
    timetable: timetable.flatMap(projectOfflinePerformance),
  });
  if (!trip) throw new Error("Invalid public trip data");
  return trip;
}
