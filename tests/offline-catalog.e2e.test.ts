import { createPrismaClient } from "../lib/prisma-client.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readOfflineCatalog, serveOfflineCatalog } from "../lib/catalog/offline.ts";
import { readPublishedOfflineTrip } from "../lib/catalog/offline-trip.ts";

// This test requires an already migrated/synthetically seeded local disposable database.
// It never clears, migrates or seeds the catalogue; mutations always roll back.
const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (
  !target ||
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname) ||
  target.searchParams.has("host") ||
  target.searchParams.has("hostaddr") ||
  !/^[a-zA-Z0-9_-]*(?:test|integration)[a-zA-Z0-9_-]*$/i.test(target.pathname.slice(1))
) {
  throw new Error("Already seeded local disposable test/integration DATABASE_URL required");
}
const db = createPrismaClient();
test.after(async () => {
  await db.$disconnect();
});
const request = (tag?: string | null) =>
  new Request("http://localhost/api/offline/catalog", {
    headers: tag ? { "If-None-Match": tag } : {},
  });

test("DB projection has stable content-derived ETag and conditional responses", async () => {
  const read = () => readOfflineCatalog(db);
  const response = await serveOfflineCatalog(request(), read);
  assert.equal(response.status, 200);
  const expected = await response.text();
  const body = JSON.parse(expected);
  assert.equal(body.editionYear, 2027);
  assert.ok(body.festivals.length > 0);
  const revision = createHash("sha256").update(expected).digest("hex");
  assert.equal(response.headers.get("etag"), `"${revision}"`);
  assert.equal(response.headers.get("x-catalog-revision"), revision);
  const stable = await serveOfflineCatalog(request(), read);
  assert.equal(await stable.text(), expected);
  assert.equal(stable.headers.get("etag"), response.headers.get("etag"));
  const conditional = await serveOfflineCatalog(request(response.headers.get("etag")), read);
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
});

test("real DB content mutations invalidate ETag; timestamps alone do not; missing rows fail closed", async () => {
  const rollback = new Error("rollback offline test");
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const read = () => readOfflineCatalog(tx);
        const before = await serveOfflineCatalog(request(), read);
        assert.equal(before.status, 200);
        const etag = before.headers.get("etag");
        const edition = await tx.festivalEdition.findFirstOrThrow({
          where: { year: 2027, recordState: "CURRENT" },
        });
        await tx.festivalEdition.update({
          where: { id: edition.id },
          data: { sourceUpdatedAt: new Date("2035-01-01") },
        });
        assert.equal((await serveOfflineCatalog(request(etag), read)).status, 304);
        await tx.festival.update({
          where: { id: edition.festivalId },
          data: { name: "Offline mutation check" },
        });
        const renamed = await serveOfflineCatalog(request(etag), read);
        assert.equal(renamed.status, 200);
        assert.notEqual(renamed.headers.get("etag"), etag);
        await tx.festivalEdition.update({
          where: { id: edition.id },
          data: { startDate: new Date("2027-12-30"), endDate: new Date("2027-12-31") },
        });
        const dated = await serveOfflineCatalog(request(renamed.headers.get("etag")), read);
        assert.equal(dated.status, 200);
        const basePerformance = {
          editionId: edition.id,
          date: new Date("2027-12-30"),
          stage: "Test",
          start: "20:00",
          timeZone: "Europe/Berlin",
          sourceUrl: "https://festival.example.test/timetable/",
          observedAt: new Date("2026-11-12T10:00:00Z"),
        };
        await tx.timetablePerformance.createMany({
          data: [
            { ...basePerformance, artistName: "No time zone", timeZone: null },
            { ...basePerformance, artistName: "No source", sourceUrl: null },
            { ...basePerformance, artistName: "No observation", observedAt: null },
            { ...basePerformance, artistName: "Invalid zone", timeZone: "City/Unknown" },
            { ...basePerformance, artistName: "Invalid source", sourceUrl: "unverified" },
            { ...basePerformance, artistName: "Invalid clock", start: "25:00" },
          ],
        });
        const datedTag = dated.headers.get("etag");
        assert.equal((await serveOfflineCatalog(request(datedTag), read)).status, 304);

        await tx.timetablePerformance.create({
          data: { ...basePerformance, artistName: "Verified offline artist" },
        });
        const withSchedule = await serveOfflineCatalog(request(datedTag), read);
        assert.equal(withSchedule.status, 200);
        const schedule = await withSchedule.text();
        assert.match(schedule, /"artist":"Verified offline artist","timeZone":"Europe\/Berlin"/);
        assert.doesNotMatch(
          schedule,
          /No time zone|No source|No observation|Invalid zone|Invalid source|Invalid clock|sourceUrl|observedAt/,
        );
        await tx.festivalEdition.updateMany({
          where: { year: 2027, recordState: "CURRENT" },
          data: { recordState: "TRACKING" },
        });
        const missing = await serveOfflineCatalog(request("*"), read);
        assert.equal(missing.status, 503);
        assert.equal(missing.headers.get("cache-control"), "no-store");
        assert.equal(missing.headers.get("etag"), null);
        throw rollback;
      },
      { timeout: 15_000 },
    ),
    (error) => error === rollback,
  );
});

test("offline catalogue and trip omit performances outside the edition dates", async () => {
  const rollback = new Error("rollback schedule range test");
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const edition = await tx.festivalEdition.findFirstOrThrow({
          where: { festival: { slug: "synthetic-fest" }, year: 2027, recordState: "CURRENT" },
        });
        await tx.festivalEdition.update({
          where: { id: edition.id },
          data: { startDate: new Date("2027-12-30"), endDate: new Date("2028-01-02") },
        });
        const proof = {
          editionId: edition.id,
          stage: "Edition range fixture",
          start: "20:00",
          timeZone: "Europe/Berlin",
          sourceUrl: "https://festival.example.test/timetable/",
          observedAt: new Date("2027-11-12T10:00:00Z"),
        };
        await tx.timetablePerformance.createMany({
          data: [
            { ...proof, date: new Date("2027-12-29"), artistName: "Too early" },
            { ...proof, date: new Date("2027-12-30"), artistName: "First day" },
            { ...proof, date: new Date("2028-01-02"), artistName: "Last day" },
            { ...proof, date: new Date("2028-01-03"), artistName: "Too late" },
          ],
        });
        const catalogue = await readOfflineCatalog(tx);
        const trip = await readPublishedOfflineTrip("synthetic-fest", 2027, tx);
        for (const timetable of [
          catalogue.festivals.find(({ slug }) => slug === "synthetic-fest")?.timetable,
          trip?.timetable,
        ]) {
          assert.deepEqual(
            timetable?.map(({ artist }) => artist),
            ["First day", "Last day"],
          );
        }
        throw rollback;
      },
      { timeout: 15_000 },
    ),
    (error) => error === rollback,
  );
});

test("offline catalogue and trip omit schedules checked in the future", async () => {
  const rollback = new Error("rollback future observation test");
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const edition = await tx.festivalEdition.findFirstOrThrow({
          where: { festival: { slug: "synthetic-fest" }, year: 2027, recordState: "CURRENT" },
        });
        const proof = {
          editionId: edition.id,
          date: new Date("2027-06-11"),
          stage: "Official stage",
          start: "20:00",
          timeZone: "Europe/Berlin",
          sourceUrl: "https://festival.example.test/timetable/",
        };
        await tx.timetablePerformance.createMany({
          data: [
            {
              ...proof,
              artistName: "Verified observation",
              observedAt: new Date("2026-11-12T10:00:00Z"),
            },
            {
              ...proof,
              start: "21:00",
              artistName: "Future observation",
              observedAt: new Date("2099-01-01T10:00:00Z"),
            },
          ],
        });
        const catalogue = await readOfflineCatalog(tx);
        const trip = await readPublishedOfflineTrip("synthetic-fest", 2027, tx);
        for (const timetable of [
          catalogue.festivals.find(({ slug }) => slug === "synthetic-fest")?.timetable,
          trip?.timetable,
        ]) {
          assert.deepEqual(
            timetable?.map(({ artist }) => artist),
            ["Verified observation"],
          );
        }
        throw rollback;
      },
      { timeout: 15_000 },
    ),
    (error) => error === rollback,
  );
});

test("trip download refuses a bounded query that could hide valid performances", async () => {
  const rollback = new Error("rollback trip test");
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const edition = await tx.festivalEdition.findFirstOrThrow({
          where: { festival: { slug: "synthetic-fest" }, year: 2027, recordState: "CURRENT" },
        });
        const setup = {
          editionId: edition.id,
          date: new Date("2027-06-11"),
          stage: "Oversize fixture stage",
          start: "20:00",
          sourceUrl: "https://festival.example.test/timetable/",
          observedAt: new Date("2027-05-01T10:00:00Z"),
        };
        await tx.timetablePerformance.createMany({
          data: Array.from({ length: 800 }, (_, index) => ({
            ...setup,
            artistName: `Invalid fixture ${index}`,
            timeZone: "City/Unknown",
          })),
        });
        const atLimit = await readPublishedOfflineTrip("synthetic-fest", 2027, tx);
        assert.ok(atLimit);
        assert.equal(atLimit.timetable.length, 0);
        await tx.timetablePerformance.create({
          data: {
            ...setup,
            start: "20:01",
            artistName: "Later valid performance",
            timeZone: "Europe/Berlin",
          },
        });
        await assert.rejects(
          readPublishedOfflineTrip("synthetic-fest", 2027, tx),
          /timetable exceeds the download limit/,
        );
        throw rollback;
      },
      { timeout: 15_000 },
    ),
    (error) => error === rollback,
  );
});
