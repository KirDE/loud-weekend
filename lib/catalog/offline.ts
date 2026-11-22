import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readApprovedRockEnSeineHiatusInSnapshot } from "../ingestion/edition-lifecycle-proposal-store.ts";

// Internal ID is only for approved proof lookup; the public allowlist below
// excludes IDs, source metadata, artist profiles, URLs and review details.
const offlineSelect = {
  id: true,
  festival: { select: { slug: true, name: true } },
  startDate: true,
  endDate: true,
  timetable: { select: {
    date: true, stage: true, start: true, artistName: true, timeZone: true, status: true,
  } },
} satisfies Prisma.FestivalEditionSelect;

type OfflineEdition = Prisma.FestivalEditionGetPayload<{ select: typeof offlineSelect }>;
type OfflineSnapshot = Pick<Prisma.TransactionClient, "festivalEdition" | "editionLifecycleProposalSnapshot">;
type OfflineDatabase = PrismaClient | OfflineSnapshot;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const dateOnly = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

export function projectOfflineCatalog(rows: readonly OfflineEdition[]) {
  const festivals = rows.map((row) => ({
    slug: row.festival.slug,
    name: row.festival.name,
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    timetable: row.timetable.map((entry) => ({
      date: dateOnly(entry.date)!, stage: entry.stage, start: entry.start,
      artist: entry.artistName, timeZone: entry.timeZone ?? "UTC",
      status: entry.status === "CANCELLED" ? "cancelled" : "scheduled",
    })).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  })).sort((a, b) => compare(a.slug, b.slug));
  return {
    schemaVersion: 1,
    dataVersion: "festivals-2027-v1",
    editionYear: 2027,
    // A live deterministic representation has no build/generation timestamp.
    generatedAt: null,
    timetableStatus: festivals.some((festival) => festival.timetable.length) ? "published" : "not-published",
    festivals,
  };
}

export async function readOfflineCatalog(database?: OfflineDatabase) {
  const client = database ?? (await import("../db.ts")).db;
  const read = async (tx: OfflineSnapshot) => {
    const rows = await tx.festivalEdition.findMany({
      where: { year: 2027, recordState: "CURRENT" }, select: offlineSelect,
    });
    if (!rows.length) throw new Error("Offline catalogue unavailable");
    const scheduled = [];
    for (const row of rows) {
      // Approved historical notice, not fresh inventory. Pending/rejected do not
      // suppress events; damaged latest/approved proof throws (HTTP 503).
      if (row.festival.slug === "rock-en-seine"
        && await readApprovedRockEnSeineHiatusInSnapshot(tx, row.id)) continue;
      scheduled.push(row);
    }
    // A nonempty catalogue with every edition paused is a valid empty schedule.
    return projectOfflineCatalog(scheduled);
  };
  return "$transaction" in client
    ? client.$transaction(read, { isolationLevel: "RepeatableRead" })
    : read(client);
}

export async function serveOfflineCatalog(
  request: Request,
  read: () => Promise<ReturnType<typeof projectOfflineCatalog>> = readOfflineCatalog,
) {
  try {
    // Always read before evaluating validators, including wildcard validators.
    const body = JSON.stringify(await read());
    const revision = createHash("sha256").update(body).digest("hex");
    const etag = `"${revision}"`;
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=0, must-revalidate, no-transform",
      "ETag": etag,
      "X-Catalog-Revision": revision,
    });
    const matches = request.headers.get("if-none-match")?.split(",").some((value) => {
      const tag = value.trim();
      return tag === "*" || tag === etag || tag === `W/${etag}`;
    });
    if (matches) return new Response(null, { status: 304, headers });
    return new Response(body, { headers });
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
