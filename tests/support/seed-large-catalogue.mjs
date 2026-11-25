import assert from "node:assert/strict";
import { createPrismaClient } from "../../lib/prisma-client.mjs";

import { requireLocalDisposableDatabase } from "./disposable-db.ts";

const name = requireLocalDisposableDatabase(process.env.DATABASE_URL);
assert.equal(name, "loud_weekend_475_mobile_test");
assert.equal(new URL(process.env.DATABASE_URL).search, "");
const db = createPrismaClient();
const observed = new Date("2026-11-20T11:00:00Z");
const variants = [
  ["Germany", "DE", 52, 13],
  ["France", "FR", 48, 2],
  ["Austria", "AT", 47, 14],
  ["Sweden", "SE", 59, 18],
  ["Netherlands", "NL", 52, 5],
  ["Spain", "ES", 41, 2],
];
const artists = Array.from({ length: 3500 }, (_, i) => ({
  id: `mobile-artist-${i}`,
  slug: `mobile-artist-${i}`,
  name: `Fixture Artist ${i}`,
  aliases: [],
  genres: [i % 2 ? "metal" : "rock"],
  identityState: "UNRESOLVED",
  topTracks: [],
  recentSetlists: [],
  freshness: {},
}));
const festivals = Array.from({ length: 550 }, (_, i) => {
  const [country, countryCode, latitude, longitude] = variants[i % variants.length];
  return {
    id: `mobile-fest-${i}`,
    slug: `mobile-fest-${i}`,
    name: `Fixture Festival ${i}`,
    city: `Fixture City ${i % 50}`,
    country,
    countryCode,
    latitude,
    longitude,
    officialUrl: "https://festival.example.test/",
    genres: [i % 2 ? "metal" : "rock"],
    catalogOrder: i,
  };
});
const editions = festivals.flatMap(({ id }, i) =>
  ["ARCHIVED", "CURRENT", "TRACKING"].map((recordState, offset) => {
    const year = 2026 + offset;
    const tracking = recordState === "TRACKING";
    const month = 4 + (i % 6);
    const start = 1 + (i % 24);
    return {
      id: `${id}-${year}`,
      festivalId: id,
      year,
      recordState,
      startDate: tracking ? null : new Date(Date.UTC(year, month, start)),
      endDate: tracking ? null : new Date(Date.UTC(year, month, start + 2)),
      status: tracking ? "TBA" : "CONFIRMED",
      completeness: tracking ? "TBA" : "COMPLETE",
      ticketStatus: "UNKNOWN",
      sourceUpdatedAt: observed,
      snapshotAt: recordState === "ARCHIVED" ? observed : null,
    };
  }),
);
const lineup = editions
  .filter(({ recordState }) => recordState !== "TRACKING")
  .flatMap((row, i) =>
    Array.from({ length: 12 }, (_, position) => ({
      editionId: row.id,
      artistId: artists[(Math.floor(i / 2) * 7 + position) % artists.length].id,
      billing: position < 2 ? "HEADLINER" : "LINEUP",
      position,
    })),
  );
try {
  const existingFixtureCount = await db.festival.count({
    where: { id: { startsWith: "mobile-fest-" } },
  });
  if (existingFixtureCount === 0) {
    assert.equal(await db.festival.count(), 1, "Use a freshly migrated dedicated test database");
    assert.equal(await db.artist.count(), 0, "Use a freshly migrated dedicated test database");
    await db.$transaction(async (tx) => {
      await tx.artist.createMany({ data: artists });
      await tx.festival.createMany({ data: festivals });
      await tx.festivalEdition.createMany({ data: editions });
      for (let start = 0; start < lineup.length; start += 1000) {
        await tx.lineupEntry.createMany({ data: lineup.slice(start, start + 1000) });
      }
    });
  }
  assert.equal(await db.festival.count(), 551);
  assert.equal(await db.festivalEdition.count(), 1651);
  assert.equal(await db.artist.count(), 3500);
  assert.equal(await db.lineupEntry.count(), 13200);
  console.log(
    "Synthetic fixture ready: 550 synthetic festivals, 1650 synthetic editions plus one " +
      "migration-seeded fixture, 3500 artists, 13200 billing rows",
  );
} finally {
  await db.$disconnect();
}
