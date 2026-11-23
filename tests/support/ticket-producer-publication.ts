import {
  Prisma,
  type Artist,
  type Festival,
  type FestivalEdition,
  type LineupEntry,
} from "@prisma/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "./disposable-db.ts";
import { seedCatalog } from "./seed-catalog.ts";
import { catalogSeed } from "./catalog.ts";
import { readCatalog } from "../../lib/catalog/repository.ts";
import { publishIngestionResult } from "../../lib/catalog/publication.ts";
import { createIngestionRun, persistAttempt } from "../../lib/ingestion/repository.ts";
import { evaluateCandidate } from "../../lib/ingestion/policy.ts";
import type { FestivalCandidate, IngestionResult } from "../../lib/ingestion/types.ts";

/** Frozen public structural source data, local synthetic DB and mocked GET only. */
export function ticketProducerPublication(input: {
  slug: string;
  produce: (
    archived: boolean,
    db: ReturnType<typeof createPrismaClient>,
  ) => Promise<FestivalCandidate>;
  forbiddenCandidates?: (candidate: FestivalCandidate) => FestivalCandidate[];
  refusalPattern?: RegExp;
  exerciseAnnouncementAddition?: boolean;
}) {
  test(
    `${input.slug}` +
      ": source producer → persisted evidence → canonical readback/" +
      "replay and stale-publication rollback",
    async () => {
      requireLocalDisposableDatabase(process.env.DATABASE_URL);
      const db = createPrismaClient(),
        sourceCommit = `test-ticket-${randomUUID()}`;
      let priorFestival: Festival | null | undefined;
      let priorEdition: (FestivalEdition & { lineup: LineupEntry[] }) | null | undefined;
      let fixtureFestivalId: string | undefined;
      let fixtureYear: number | undefined;
      const priorArtists: Artist[] = [],
        createdArtistSlugs: string[] = [];
      const json = (value: Prisma.JsonValue) =>
        value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
      const persist = async (value: IngestionResult) => {
        const run = await createIngestionRun(db, {
          trigger: "TEST",
          sourceCommit,
          totalSources: 1,
        });
        return persistAttempt(db, {
          runId: run.id,
          festivalSlug: input.slug,
          requestedUrl: value.sourceUrl,
          finalUrl: value.sourceUrl,
          httpStatus: 200,
          durationMs: 1,
          startedAt: new Date(value.fetchedAt),
          endedAt: new Date(value.fetchedAt),
          result: value,
        });
      };
      const read = async () =>
        (await readCatalog({ database: db })).festivals.find((f) => f.slug === input.slug)!;
      try {
        const candidate = await input.produce(false, db);
        assert.ok(
          candidate.ticketStatus,
          "fixture must exercise actual source-backed ticket status",
        );
        assert.equal(candidate.festivalSlug, input.slug);
        assert.equal(candidate.observedEditionYears.length, 1);
        const year = candidate.observedEditionYears[0];
        fixtureYear = year;
        priorFestival = await db.festival.findUnique({ where: { slug: input.slug } });
        priorEdition = priorFestival
          ? await db.festivalEdition.findUnique({
              where: { festivalId_year: { festivalId: priorFestival.id, year } },
              include: { lineup: true },
            })
          : null;
        const names = [...new Set([...(candidate.headliners ?? []), ...(candidate.lineup ?? [])])];
        const artists = [];
        for (const [i, name] of names.entries()) {
          const existing = await db.artist.findFirst({
            where: { name: { equals: name, mode: "insensitive" } },
          });
          const slug = existing?.slug ?? `ticket-${input.slug}-${i}-${sourceCommit}`;
          if (existing) priorArtists.push(existing);
          else createdArtistSlugs.push(slug);
          artists.push({ ...catalogSeed.artists[0], name, slug });
        }
        const festival = {
          ...catalogSeed.festivals[0],
          slug: input.slug,
          name: `Synthetic ${input.slug}`,
          officialUrl: candidate.sourceUrl,
          editionYear: year,
          startDate: candidate.startDate ?? `${year}-06-01`,
          endDate: candidate.endDate ?? `${year}-06-04`,
          city: candidate.city,
          headliners: candidate.headliners ?? [],
          lineup: input.exerciseAnnouncementAddition
            ? candidate.lineup!.slice(0, -1)
            : (candidate.lineup ?? []),
        };
        await seedCatalog(db, {
          ...catalogSeed,
          artists: [...catalogSeed.artists, ...artists],
          festivals: [...catalogSeed.festivals, festival],
          editions: [
            ...catalogSeed.editions,
            { ...festival, recordState: "current", completeness: "partial", provenance: [] },
          ],
        });
        const edition = await db.festivalEdition.findFirstOrThrow({
          where: { festival: { slug: input.slug }, year, recordState: "CURRENT" },
        });
        fixtureFestivalId = edition.festivalId;
        await db.festivalEdition.update({
          where: { id: edition.id },
          data: {
            status:
              candidate.status === "confirmed"
                ? "CONFIRMED"
                : candidate.status === "tba"
                  ? "TBA"
                  : "PARTIAL",
            ticketStatus: "UNKNOWN",
            ticketsUrl: null,
          },
        });
        const jobs = await db.catalogPlaylistRefresh.count(),
          bindings = await db.festivalPlaylist.count();
        const value = evaluateCandidate(await read(), candidate);
        assert.equal(value.publishable, true, JSON.stringify(value.reviewReasons));
        assert.ok(value.changes.some((c) => c.field === "ticketStatus"));
        assert.ok(
          value.changes.every(
            (c) =>
              ["ticketStatus", "ticketsUrl"].includes(c.field) ||
              (input.exerciseAnnouncementAddition && c.kind === "artist_added"),
          ),
          "only independently verified announcement additions may accompany stock",
        );
        // Explicitly prove the canonical boundary even with forged policy approval.
        for (const forbidden of input.forbiddenCandidates?.(structuredClone(candidate)) ?? []) {
          const blocked = evaluateCandidate(await read(), forbidden);
          assert.equal(blocked.publishable, false);
          const forged = {
            ...blocked,
            publishable: true,
            reviewReasons: [],
            changes: blocked.changes.map((c) => ({ ...c, reviewRequired: false })),
          };
          const rejected = await persist(forged),
            count = await db.catalogPublication.count();
          await assert.rejects(
            publishIngestionResult(db, { attemptId: rejected.id, result: forged, sourceCommit }),
            input.refusalPattern ?? /./,
          );
          assert.equal(await db.catalogPublication.count(), count);
          assert.equal((await read()).ticketStatus, "unknown");
          assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
        }
        const attempt = await persist(value);
        const publication = await publishIngestionResult(db, {
          attemptId: attempt.id,
          result: value,
          sourceCommit,
        });
        assert.ok(publication);
        assert.equal(publication.playlistRefreshRequested, false);
        const after = await read();
        assert.equal(after.ticketStatus, candidate.ticketStatus);
        assert.equal(after.ticketsUrl, candidate.ticketsUrl);
        if (input.exerciseAnnouncementAddition)
          assert.ok(after.lineup.includes(candidate.lineup!.at(-1)!));
        const durable = await db.ingestionEvidence.findMany({
          where: { candidate: { attemptId: attempt.id } },
        });
        for (const change of value.changes) {
          const proof = candidate.evidence.filter((e) => e.field === change.field);
          assert.ok(proof.length, change.field);
          assert.ok(
            proof.some((e) =>
              durable.some(
                (saved) =>
                  saved.field === e.field &&
                  saved.sourceUrl === e.sourceUrl &&
                  JSON.stringify(saved.observedValue) === JSON.stringify(candidate[e.field]) &&
                  (publication.evidence as { evidenceIds: string[] }).evidenceIds.includes(
                    saved.id,
                  ),
              ),
            ),
            change.field,
          );
        }
        assert.equal(
          (await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit }))
            ?.id,
          publication.id,
        );
        assert.deepEqual(evaluateCandidate(after, candidate).changes, []);
        assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
        assert.equal(await db.festivalPlaylist.count(), bindings);
        const archived = evaluateCandidate(after, await input.produce(true, db));
        assert.equal(
          archived.publishable,
          false,
          "old-edition source must not overwrite current inventory",
        );
        const archivedAttempt = await persist(archived);
        await assert.rejects(
          publishIngestionResult(db, {
            attemptId: archivedAttempt.id,
            result: archived,
            sourceCommit,
          }),
        );
        assert.equal((await read()).ticketStatus, candidate.ticketStatus);
        // A candidate valid when persisted must not overwrite a newer catalogue
        // observation; any earlier fields applied in that transaction roll back.
        await db.festivalEdition.update({
          where: { id: edition.id },
          data: { ticketStatus: "UNKNOWN", ticketsUrl: null },
        });
        const stale = evaluateCandidate(await read(), candidate),
          staleAttempt = await persist(stale);
        await db.festivalEdition.update({
          where: { id: edition.id },
          data: { ticketStatus: candidate.ticketStatus === "low" ? "SOLD_OUT" : "LOW" },
        });
        const publications = await db.catalogPublication.count();
        await assert.rejects(
          publishIngestionResult(db, { attemptId: staleAttempt.id, result: stale, sourceCommit }),
          /Stale ticketStatus/,
        );
        assert.equal(await db.catalogPublication.count(), publications);
        assert.equal(
          (await read()).ticketStatus,
          candidate.ticketStatus === "low" ? "sold_out" : "low",
        );
        assert.equal((await read()).ticketsUrl, undefined);
        assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
        assert.equal(await db.festivalPlaylist.count(), bindings);
      } finally {
        try {
          // Own only this fixture's new rows. Existing source state is restored,
          // so a later suite can create its own same-slug/year shell safely.
          if (fixtureFestivalId && priorFestival === null) {
            await db.festival.delete({ where: { id: fixtureFestivalId } });
          } else if (fixtureFestivalId && priorFestival) {
            if (priorEdition) {
              await db.lineupEntry.deleteMany({ where: { editionId: priorEdition.id } });
              await db.festivalEdition.update({
                where: { id: priorEdition.id },
                data: {
                  startDate: priorEdition.startDate,
                  endDate: priorEdition.endDate,
                  status: priorEdition.status,
                  ticketStatus: priorEdition.ticketStatus,
                  ticketsUrl: priorEdition.ticketsUrl,
                  recordState: priorEdition.recordState,
                  completeness: priorEdition.completeness,
                  sourceUpdatedAt: priorEdition.sourceUpdatedAt,
                  snapshotAt: priorEdition.snapshotAt,
                },
              });
              if (priorEdition.lineup.length)
                await db.lineupEntry.createMany({ data: priorEdition.lineup });
            } else if (fixtureYear) {
              await db.festivalEdition.deleteMany({
                where: { festivalId: fixtureFestivalId, year: fixtureYear },
              });
            }
            await db.festival.update({
              where: { id: priorFestival.id },
              data: {
                name: priorFestival.name,
                country: priorFestival.country,
                countryCode: priorFestival.countryCode,
                city: priorFestival.city,
                officialUrl: priorFestival.officialUrl,
                genres: priorFestival.genres,
                catalogOrder: priorFestival.catalogOrder,
                latitude: priorFestival.latitude,
                longitude: priorFestival.longitude,
              },
            });
          }
          for (const artist of priorArtists)
            await db.artist.update({
              where: { id: artist.id },
              data: {
                name: artist.name,
                aliases: artist.aliases,
                genres: artist.genres,
                biography: artist.biography,
                identityState: artist.identityState,
                topTracks: artist.topTracks,
                recentSetlists: json(artist.recentSetlists),
                freshness: json(artist.freshness),
              },
            });
          if (createdArtistSlugs.length)
            await db.artist.deleteMany({ where: { slug: { in: createdArtistSlugs } } });
          await seedCatalog(db, catalogSeed);
        } finally {
          await db.$disconnect();
        }
      }
    },
  );
}
