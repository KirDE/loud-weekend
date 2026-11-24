import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DatabaseCatalogRepository } from "../lib/catalog/repository.ts";

const date = new Date("2027-06-11T00:00:00.000Z");
const observed = new Date("2026-11-20T11:00:00.000Z");
const artists = Array.from({ length: 3_500 }, (_, index) => ({
  id: `artist-${index}`,
  slug: `artist-${index}`,
  name: `Fixture Artist ${index}`,
  aliases: [],
  identities: [],
  links: [],
  provenance: [],
  freshness: {},
  genres: [],
  identityState: "UNRESOLVED",
  topTracks: [],
  recentSetlists: [],
}));
const editions = Array.from({ length: 550 }, (_, index) => {
  const festival = {
    slug: `fixture-${index}`,
    name: `Fixture Festival ${index}`,
    country: "Germany",
    countryCode: "DE",
    genres: ["metal"],
    city: "Fixture city",
    officialUrl: "https://festival.example.test/",
    latitude: 52,
    longitude: 13,
  };
  return ["ARCHIVED", "CURRENT", "TRACKING"].map((recordState, offset) => {
    const lineup =
      recordState === "TRACKING"
        ? []
        : Array.from({ length: 12 }, (_, position) => ({
            billing: position < 2 ? "HEADLINER" : "LINEUP",
            status: "ANNOUNCED",
            position,
            artist: artists[(index * 7 + position) % artists.length],
          }));
    return {
      festival,
      recordState,
      year: 2026 + offset,
      status: "CONFIRMED",
      ticketStatus: "UNKNOWN",
      completeness: "COMPLETE",
      startDate: date,
      endDate: date,
      sourceUpdatedAt: observed,
      snapshotAt: null,
      provenance: [],
      sources: [],
      playlists: [],
      playlistLinks: [],
      lineup,
      timetable: lineup.map(({ artist }) => ({
        date,
        stage: "Fixture stage",
        start: "18:00",
        artistName: artist.name,
        timeZone: "Europe/Berlin",
        status: "ANNOUNCED",
        sourceUrl: festival.officialUrl,
        observedAt: observed,
      })),
    };
  });
}).flat();

const catalogue = new DatabaseCatalogRepository({
  festivalEdition: { findMany: async () => editions },
  artist: { findMany: async () => artists },
});
for (let run = 0; run < 8; run++) await catalogue.read();

const times = [];
let result;
for (let run = 0; run < 35; run++) {
  const start = performance.now();
  result = await catalogue.read();
  times.push(performance.now() - start);
}
times.sort((left, right) => left - right);
const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
console.log(
  JSON.stringify(
    {
      currentFestivals: result.festivals.length,
      editionRows: editions.length,
      artistRows: artists.length,
      publicArtists: result.artists.length,
      digest,
      p50Ms: Number(times[17].toFixed(2)),
      p90Ms: Number(times[Math.ceil(times.length * 0.9) - 1].toFixed(2)),
    },
    null,
    2,
  ),
);
