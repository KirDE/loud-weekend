import { editionDateProblem } from "../domain/edition-dates.ts";
import { ticketSupplementUrl, ticketSupplementPurchaseUrl } from "../ingestion/ticket-supplements.ts";
import { isProvinssiAnnouncement, PROVINSSI_HOME } from '../ingestion/adapters/provinssi.ts';
import { assertAdminArtistReviewAllowed } from "./admin-artist-review.ts";
import { artistAliasIndex } from "./artist-aliases.ts";
import { isDownloadAnnouncement } from "../ingestion/adapters/download.ts";
import {
  ArtistIdentityState,
  CatalogPublicationSource,
  FestivalStatus,
  LineupBilling,
  Prisma,
  TicketStatus,
  type PrismaClient,
} from "@prisma/client";
import { uniqueNotificationEvents, type PublishedNotificationEvent } from "../ingestion/notification-events.ts";
import type { FestivalCandidate, IngestionResult } from "../ingestion/types.ts";
import type { AgentDecision } from "../ingestion/agent-contract.ts";
import { isIdaysAnnouncement } from "../ingestion/adapters/idays.ts";
import {isGraspopAnnouncement,GRASPOP_FAQ} from '../ingestion/adapters/graspop.ts';

type Database = PrismaClient | Prisma.TransactionClient;
type CatalogChange = { field: string; before?: unknown; after?: unknown };

const festivalStatuses = { confirmed: FestivalStatus.CONFIRMED, partial: FestivalStatus.PARTIAL, tba: FestivalStatus.TBA } as const;
const ticketStatuses = { available: TicketStatus.AVAILABLE, low: TicketStatus.LOW, not_on_sale: TicketStatus.NOT_ON_SALE, sold_out: TicketStatus.SOLD_OUT, sales_ended: TicketStatus.SALES_ENDED, unavailable: TicketStatus.UNAVAILABLE, unknown: TicketStatus.UNKNOWN } as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const dateOnly = (value: unknown) => typeof value === "string" && value ? new Date(`${value}T00:00:00.000Z`) : null;
const isoDate = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function artistSlug(name: string) {
  return encodeURIComponent(name.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
}

function stringList(value: unknown, field: string) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n|,/) : [];
  const cleaned = values.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (!cleaned.length && value !== "" && (!Array.isArray(value) || value.length)) throw new Error(`Invalid ${field} list`);
  const keys = cleaned.map((item) => item.toLocaleLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error(`Ambiguous duplicate ${field} artist`);
  return cleaned;
}

function artistResolver(db: Database, observedAt: Date) {
  // One lazy global read per publication; newly created identities enter the
  // same index immediately, including slug collisions within this roster.
  const load = async () => {
    const all = await db.artist.findMany({ select: { id: true, slug: true, name: true, aliases: true } });
    return { lookup: artistAliasIndex(all, { orthography: true }), bySlug: new Map(all.map(a => [a.slug, a])) };
  };
  let snapshot: ReturnType<typeof load> | undefined;
  return async (name: string) => {
    const { lookup, bySlug } = await (snapshot ??= load());
    const slug = artistSlug(name);
    const matches = lookup(name);
    if (matches.length > 1) throw new Error(`Ambiguous artist identity for ${name}`);
    const matched = matches[0];
    if (matched) return matched;
    const collision = bySlug.get(slug);
    if (collision) throw new Error(`Artist slug collision: ${slug} (${collision.name} / ${name})`);
    if (!slug) throw new Error(`Cannot derive artist slug for ${name}`);
    const checkedAt = observedAt.toISOString().slice(0, 10);
    const created = await db.artist.create({ data: {
      slug, name, aliases: [], genres: [], identityState: ArtistIdentityState.UNRESOLVED,
      topTracks: [], recentSetlists: json([]),
      freshness: json({
        profile: { checkedAt, cadenceDays: 90, refreshAfter: checkedAt },
        music: { checkedAt, cadenceDays: 14, refreshAfter: checkedAt },
        setlists: { checkedAt, cadenceDays: 7, refreshAfter: checkedAt },
      }),
    } });
    lookup.add(created);
    bySlug.set(created.slug, created);
    return created;
  };
}

type EnsureArtist = ReturnType<typeof artistResolver>;

async function replaceLineup(db: Database, editionId: string, billing: LineupBilling, names: string[], ensureArtist: EnsureArtist) {
  const otherBilling = billing === LineupBilling.HEADLINER ? LineupBilling.LINEUP : LineupBilling.HEADLINER;
  const existing = await db.lineupEntry.findMany({ where: { editionId, billing }, include: { artist: true }, orderBy: { position: "asc" } });
  if (same(existing.map(({ artist }) => artist.name), names)) return false;
  const other = await db.lineupEntry.findMany({ where: { editionId, billing: otherBilling }, include: { artist: true } });
  const otherNames = new Set(other.map(({ artist }) => artist.name.toLocaleLowerCase()));
  if (names.some((name) => otherNames.has(name.toLocaleLowerCase()))) throw new Error("Artist cannot have ambiguous lineup billing");
  const artists = [];
  for (const name of names) artists.push(await ensureArtist(name));
  if (new Set(artists.map(a => a.id)).size !== artists.length || artists.some(a => other.some(entry => entry.artistId === a.id))) throw new Error("Artist cannot have ambiguous lineup billing or duplicate alias identities");
  if (same(existing.map(entry => entry.artistId), artists.map(a => a.id))) return false;
  await db.lineupEntry.deleteMany({ where: { editionId, billing } });
  if (artists.length) await db.lineupEntry.createMany({ data: artists.map((artist, position) => ({ editionId, artistId: artist.id, billing, position })) });
  return true;
}

async function addLineupArtist(db: Database, editionId: string, billing: LineupBilling, name: string, ensureArtist: EnsureArtist) {
  const artist = await ensureArtist(name);
  const existing = await db.lineupEntry.findUnique({ where: { editionId_artistId: { editionId, artistId: artist.id } } });
  if (existing) {
    if (existing.billing !== billing) throw new Error(`Ambiguous billing change for ${name}`);
    return false;
  }
  const last = await db.lineupEntry.aggregate({ where: { editionId, billing }, _max: { position: true } });
  await db.lineupEntry.create({ data: { editionId, artistId: artist.id, billing, position: (last._max.position ?? -1) + 1 } });
  return true;
}

async function applyFestivalChanges(db: Database, input: {
  festivalSlug: string;
  expectedYear?: number;
  changes: CatalogChange[];
  strictBefore: boolean;
  observedAt: Date;
}) {
  const festival = await db.festival.findUnique({ where: { slug: input.festivalSlug }, include: { editions: { where: { recordState: "CURRENT" } } } });
  if (!festival) throw new Error(`Unknown catalogue festival: ${input.festivalSlug}`);
  if (festival.editions.length !== 1) throw new Error(`Ambiguous current edition for ${input.festivalSlug}`);
  const edition = festival.editions[0];
  if (input.expectedYear !== undefined && edition.year !== input.expectedYear) throw new Error(`Candidate edition ${input.expectedYear} does not match catalogue edition ${edition.year}`);

  const dateChanges = input.changes.filter(({ field }) => field === "startDate" || field === "endDate");
  if (dateChanges.length) {
    const proposed = new Map(dateChanges.map(({ field, after }) => [field, after === "" ? null : after]));
    if (proposed.size !== dateChanges.length) throw new Error("Duplicate festival date changes");
    const start = proposed.has("startDate") ? proposed.get("startDate") : isoDate(edition.startDate);
    const end = proposed.has("endDate") ? proposed.get("endDate") : isoDate(edition.endDate);
    const problem = editionDateProblem(edition.year, start, end);
    if (problem) throw new Error(problem);
  }

  // A delayed observation can still update an unchanged field without
  // making the edition's most recent source observation appear older.
  const sourceUpdatedAt = input.observedAt > edition.sourceUpdatedAt ? input.observedAt : edition.sourceUpdatedAt;
  const ensureArtist = artistResolver(db, input.observedAt);
  const changedFields: string[] = [];
  for (const change of input.changes) {
    let current: unknown;
    let changed = false;
    switch (change.field) {
      case "city":
      case "name":
      case "country":
      case "officialUrl": {
        current = festival[change.field];
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ${change.field} value for ${input.festivalSlug}`);
        if (!same(current, change.after)) {
          if (typeof change.after !== "string" || !change.after.trim()) throw new Error(`Invalid ${change.field}`);
          await db.festival.update({ where: { id: festival.id }, data: { [change.field]: change.after.trim() } });
          changed = true;
        }
        break;
      }
      case "startDate":
      case "endDate": {
        current = isoDate(edition[change.field]);
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ${change.field} value for ${input.festivalSlug}`);
        if (!same(current, change.after)) {
          await db.festivalEdition.update({ where: { id: edition.id }, data: { [change.field]: dateOnly(change.after), sourceUpdatedAt } });
          changed = true;
        }
        break;
      }
      case "ticketsUrl": {
        current = edition.ticketsUrl;
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ticketsUrl value for ${input.festivalSlug}`);
        if (!same(current, change.after)) {
          if (change.after !== undefined && change.after !== null && typeof change.after !== "string") throw new Error("Invalid ticketsUrl");
          await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketsUrl: change.after as string | null | undefined, sourceUpdatedAt } });
          changed = true;
        }
        break;
      }
      case "completeness": {
        current = edition.completeness.toLocaleLowerCase();
        if (input.festivalSlug !== "download" || change.before !== "tba" || change.after !== "partial") throw new Error("Invalid completeness promotion");
        if (input.strictBefore && current !== change.before && current !== change.after) throw new Error("Stale completeness");
        if (current !== change.after) { await db.festivalEdition.update({where:{id:edition.id},data:{completeness:"PARTIAL",sourceUpdatedAt}}); changed = true; }
        break;
      }
      case "status": {
        current = edition.status.toLocaleLowerCase();
        const next = festivalStatuses[String(change.after).toLocaleLowerCase() as keyof typeof festivalStatuses];
        if (!next) throw new Error(`Invalid festival status: ${String(change.after)}`);
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale status value for ${input.festivalSlug}`);
        if (edition.status !== next) { await db.festivalEdition.update({ where: { id: edition.id }, data: { status: next, sourceUpdatedAt } }); changed = true; }
        break;
      }
      case "ticketStatus": {
        current = edition.ticketStatus.toLocaleLowerCase();
        const next = ticketStatuses[String(change.after).toLocaleLowerCase() as keyof typeof ticketStatuses];
        if (!next) throw new Error(`Invalid ticket status: ${String(change.after)}`);
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ticketStatus value for ${input.festivalSlug}`);
        if (edition.ticketStatus !== next) { await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketStatus: next, sourceUpdatedAt } }); changed = true; }
        break;
      }
      case "lineup":
      case "headliners": {
        const billing = change.field === "headliners" ? LineupBilling.HEADLINER : LineupBilling.LINEUP;
        changed = Array.isArray(change.after) || (typeof change.after === "string" && /\r?\n|,/.test(change.after))
          ? await replaceLineup(db, edition.id, billing, stringList(change.after, change.field), ensureArtist)
          : await addLineupArtist(db, edition.id, billing, String(change.after), ensureArtist);
        break;
      }
      default:
        throw new Error(`Unsupported catalogue publication field: ${change.field}`);
    }
    if (changed) changedFields.push(change.field);
  }
  if (changedFields.includes("lineup") || changedFields.includes("headliners")) {
    await db.festivalEdition.updateMany({
      where: { id: edition.id, sourceUpdatedAt: { lt: input.observedAt } },
      data: { sourceUpdatedAt: input.observedAt },
    });
  }
  return { edition, changedFields: [...new Set(changedFields)] };
}

async function createPublication(db: Database, input: {
  source: CatalogPublicationSource;
  sourceId: string;
  festivalSlug: string;
  editionYear: number;
  actorLabel: string;
  fields: string[];
  evidence: unknown;
  playlistRefreshDeferral?: { policy: string; reason: string };
}) {
  if (!input.fields.length) return null;
  const lineupChanged = input.fields.some((field) => field === "lineup" || field === "headliners");
  const publication = await db.catalogPublication.create({ data: {
    source: input.source, sourceId: input.sourceId, festivalSlug: input.festivalSlug,
    editionYear: input.editionYear, actorLabel: input.actorLabel, fields: input.fields,
    lineupChanged, evidence: json(input.evidence),
  } });
  const playlistRefreshRequested = lineupChanged && !input.playlistRefreshDeferral && input.festivalSlug !== "full-rewind";
  if (playlistRefreshRequested) await db.catalogPlaylistRefresh.create({ data: { publicationId: publication.id, festivalSlug: input.festivalSlug } });
  return { ...publication, playlistRefreshRequested };
}

export async function publishIngestionResult(client: PrismaClient, input: { attemptId: string; result: IngestionResult; sourceCommit: string; sourceLease?: { id: string; owner: string; updatedAt: Date }; notificationEvents?: PublishedNotificationEvent[] }) {
  if (!input.result.publishable || input.result.reviewReasons.length || input.result.changes.some(({ reviewRequired }) => reviewRequired)) throw new Error(`Refusing ambiguous ingestion publication for ${input.result.festivalSlug}`);
  if (input.sourceLease && !input.notificationEvents) throw new Error("Leased publication requires staged notification events");
  if (!input.sourceLease && input.notificationEvents) throw new Error("Only leased due publications can stage notification events");
  return client.$transaction(async (db) => {
    if (input.sourceLease) {
      // Hold the same source row lock that a reclaiming worker needs. A stale
      // worker cannot publish even if its candidate was persisted earlier.
      const held = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "FestivalSource"
        WHERE id = ${input.sourceLease.id} AND "festivalSlug" = ${input.result.festivalSlug}
          AND url = ${input.result.sourceUrl} AND "leaseOwner" = ${input.sourceLease.owner}
          AND enabled = true AND "configurationBackfilledAt" IS NOT NULL
          -- Bind ISO UTC text explicitly; pg adapter Dates are timezone-naive.
          AND "updatedAt" = (${input.sourceLease.updatedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        FOR UPDATE
      `;
      if (held.length !== 1) throw new Error("Ingestion source lease is no longer active");
    }
    const candidate = await db.ingestionCandidate.findUnique({ where: { attemptId: input.attemptId }, include: { diffs: true, evidence: true, attempt: { select: { requestedUrl: true, festivalSlug: true } } } });
    if (!candidate || !candidate.publishable) throw new Error("Publishable ingestion candidate was not persisted");
    const observed = input.result.candidate;
    const stored = candidate.normalized as unknown as FestivalCandidate;
    if (!stored || [candidate.festivalSlug, candidate.attempt.festivalSlug, observed.festivalSlug, stored.festivalSlug]
      .some(slug => slug !== input.result.festivalSlug) ||
      [candidate.attempt.requestedUrl, observed.sourceUrl, stored.sourceUrl].some(url => url !== input.result.sourceUrl) ||
      !Array.isArray(stored.observedEditionYears) || !same(stored.observedEditionYears, observed.observedEditionYears) ||
      stored.observedEditionYears.length > 1) {
      throw new Error("Ingestion publication scope does not match the persisted festival, source and edition");
    }
    const sourceId = `ingestion:${candidate.id}`;
    const existing = await db.catalogPublication.findUnique({ where: { sourceId }, include: { playlistRefresh: { select: { id: true } } } });
    // Replay reports the persisted queue relation, never creating a new job.
    if (existing) return { ...existing, playlistRefreshRequested: Boolean(existing.playlistRefresh) };
    if (candidate.reviewState !== "PENDING") throw new Error(`Candidate is not pending: ${candidate.reviewState}`);
    const observedAt = new Date(stored.fetchedAt);
    if (!Number.isFinite(observedAt.getTime()) || stored.fetchedAt !== observed.fetchedAt ||
      stored.fetchedAt !== input.result.fetchedAt) {
      throw new Error("Ingestion publication does not match the persisted observation time");
    }
    if (candidate.diffs.some(({ reviewRequired }) => reviewRequired)) throw new Error("Persisted candidate requires review");
    const normalizedDiffs = (values: { field: string; before: unknown; after: unknown }[]) => values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const expected = normalizedDiffs(input.result.changes.map(({ field, before, after }) => ({ field, before: before ?? null, after: after ?? null })));
    const persisted = normalizedDiffs(candidate.diffs.map(({ field, beforeValue, afterValue }) => ({ field, before: beforeValue, after: afterValue })));
    if (!same(expected, persisted)) throw new Error("Persisted ingestion diff does not match publication request");
    const expectedYear = stored.observedEditionYears[0] ?? candidate.sourceYear ?? undefined;
    if (!expectedYear && input.result.changes.some(({ field }) => field === "lineup" || field === "headliners")) throw new Error("Cannot publish a lineup without one verified edition year");
    // Secondary ticket observations are publishable only with the same exact
    // source, edition, value and durable evidence that passed the producer.
    // Do not extend the separate Impericon/I-Days publication paths here (#497).
    if (observed.ticketSupplement || stored.ticketSupplement) {
      const registeredSource = { festivalSlug: input.result.festivalSlug,
        url: input.result.sourceUrl, editionYear: expectedYear ?? 0,
        strategies: ["html_fallback", "official_markup"] as ("html_fallback" | "official_markup")[], refreshPolicy: "daily" as const, enabled: true };
      const ticketUrl = ticketSupplementUrl(registeredSource);
      const purchaseUrl = ticketSupplementPurchaseUrl(registeredSource);
      const provenance = { sourceUrl: input.result.sourceUrl, ticketUrl, editionYear: expectedYear };
      const valid = ticketUrl && same(observed.ticketSupplement, provenance) && same(stored.ticketSupplement, provenance) && candidate.festivalSlug === input.result.festivalSlug &&
        candidate.attempt.requestedUrl === input.result.sourceUrl &&
        observed.sourceUrl === input.result.sourceUrl && stored.sourceUrl === observed.sourceUrl &&
        stored.festivalSlug === observed.festivalSlug && observed.festivalSlug === candidate.festivalSlug &&
        same(observed.observedEditionYears, [expectedYear]) && same(stored.observedEditionYears, [expectedYear]) &&
        observed.ticketsUrl === purchaseUrl && stored.ticketsUrl === purchaseUrl &&
        same(stored.ticketStatus, observed.ticketStatus) &&
        ["ticketStatus", "ticketsUrl"].every(field => {
          const value = observed[field as "ticketStatus" | "ticketsUrl"];
          return observed.evidence.some(e => e.field === field && e.sourceUrl === ticketUrl && e.excerpt?.trim() &&
            candidate.evidence.some(saved => saved.field === field && saved.sourceUrl === ticketUrl &&
              same(saved.observedValue, value) && saved.excerpt === e.excerpt &&
              saved.observedAt.toISOString() === new Date(e.observedAt).toISOString()));
        }) && input.result.changes.filter(c => ["ticketStatus", "ticketsUrl"].includes(c.field))
          .every(c => same(c.after, observed[c.field as "ticketStatus" | "ticketsUrl"]));
      if (!valid) throw new Error("Ticket supplement publication requires matching persisted official ticket evidence");
    }
    const applied = await applyFestivalChanges(db, { festivalSlug: input.result.festivalSlug, expectedYear, changes: input.result.changes, strictBefore: true, observedAt });
    // Rockharz 2027 publications retain exact edition/source/field and persisted
    // evidence guards. Verified lineup changes use the normal provider queue.
    const sourceField = input.result.sourceUrl === "https://www.rockharz-festival.com/bands" ? "lineup"
      : input.result.sourceUrl === "https://www.rockharz-festival.com/headliner-alarm" ? "headliners" : undefined;
    const rockharzPublication = input.result.festivalSlug === "rockharz" &&
      applied.edition.year === 2027 && input.result.changes.some(({ field }) => field === "lineup" || field === "headliners" || field === "status");
    const verifiedSource = sourceField !== undefined && candidate.festivalSlug === "rockharz" &&
      input.result.candidate.observedEditionYears.length === 1 && input.result.candidate.observedEditionYears[0] === 2027 &&
      candidate.attempt.requestedUrl === input.result.sourceUrl && input.result.candidate.sourceUrl === input.result.sourceUrl &&
      input.result.candidate.festivalSlug === "rockharz" && input.result.changes.every(({ field, after }) =>
        (field === sourceField || (sourceField === "headliners" && field === "status" && after === "partial" &&
          input.result.candidate.status === "partial")) &&
        input.result.candidate.evidence.some((e) => e.field === field && e.sourceUrl === input.result.sourceUrl) &&
        candidate.evidence.some((e) => e.field === field && e.sourceUrl === input.result.sourceUrl)) &&
      input.result.candidate.evidence.some((e) => e.field === sourceField && e.sourceUrl === input.result.sourceUrl) &&
      candidate.evidence.some((e) => e.field === sourceField && e.sourceUrl === input.result.sourceUrl);
    if (rockharzPublication && !verifiedSource) throw new Error("Rockharz publication requires matching verified source evidence");
    // A reviewed secondary ticket page may prove inventory, but never
    // substitute for primary announcement or artist evidence.
    const verifiedSupplementTicketChange = (change: IngestionResult["changes"][number]) => {
      if (!["ticketStatus","ticketsUrl"].includes(change.field)) return false;
      const observed = input.result.candidate, stored = candidate.normalized as unknown as FestivalCandidate;
      if (!stored || observed.festivalSlug !== input.result.festivalSlug || stored.festivalSlug !== observed.festivalSlug
        || observed.sourceUrl !== input.result.sourceUrl || stored.sourceUrl !== observed.sourceUrl
        || candidate.attempt.requestedUrl !== observed.sourceUrl || observed.ticketStatus !== "available" || stored.ticketStatus !== "available"
        || observed.observedEditionYears.length !== 1 || observed.observedEditionYears[0] !== applied.edition.year
        || !Array.isArray(stored.observedEditionYears) || stored.observedEditionYears.length !== 1 || stored.observedEditionYears[0] !== applied.edition.year) return false;
      let proofUrl: string | undefined;
      if (observed.festivalSlug === "idays" && ["https://www.idays.it/","https://www.idays.it/line-up","https://www.idays.it/tickets"].includes(observed.sourceUrl)
        && observed.ticketsUrl === "https://www.idays.it/tickets") proofUrl = observed.ticketsUrl;
      if (observed.festivalSlug === "impericon" && observed.sourceUrl === "https://www.impericon.com/pages/festival") {
        try {
          const url = new URL(observed.ticketsUrl ?? "");
          const product = url.pathname.match(/^\/products\/(\d{1,2})-(\d{1,2})-(\d{2})-(20\d{2})-\d{1,2}-preisstufe-weekend-ticket$/);
          if (url.origin === "https://www.impericon.com" && !url.username && !url.password && !url.search && !url.hash && product
            && Number(product[4]) === applied.edition.year && same(stored.startDate,observed.startDate) && same(stored.endDate,observed.endDate) && observed.startDate === product[4]+"-"+product[3]+"-"+product[1].padStart(2,"0")
            && observed.endDate === product[4]+"-"+product[3]+"-"+product[2].padStart(2,"0")) proofUrl = url.href + ".js";
        } catch { /* Only a reviewed dated weekend product can supply stock. */ }
      }
      if (!proofUrl) return false;
      const field = change.field as "ticketStatus" | "ticketsUrl", value = observed[field], at = Date.parse(observed.fetchedAt);
      return value !== undefined && same(value,change.after) && same(stored[field],value) && same(stored.ticketsUrl,observed.ticketsUrl)
        && Number.isFinite(at) && observed.fetchedAt === input.result.fetchedAt && stored.fetchedAt === observed.fetchedAt
        && observed.evidence.some(e => e.field === field && e.sourceUrl === proofUrl && Date.parse(e.observedAt) === at)
        && candidate.evidence.some(e => e.field === field && e.sourceUrl === proofUrl && same(e.observedValue,value) && e.observedAt.getTime() === at);
    };
    const impericonPublication = input.result.festivalSlug === "impericon" && input.result.sourceUrl === "https://www.impericon.com/pages/festival";
    if (impericonPublication && !(candidate.festivalSlug === "impericon" && applied.edition.year === expectedYear &&
      input.result.candidate.observedEditionYears.length === 1 && input.result.candidate.observedEditionYears[0] === expectedYear &&
      candidate.attempt.requestedUrl === input.result.sourceUrl && input.result.candidate.sourceUrl === input.result.sourceUrl &&
      input.result.candidate.artistListMode === "additive" && input.result.candidate.lineupScope === "announcement" &&
      input.result.changes.every(change => verifiedSupplementTicketChange(change) || (["startDate", "endDate", "headliners", "lineup", "status"].includes(change.field) &&
        candidate.evidence.some(e => e.field === change.field && e.sourceUrl === input.result.sourceUrl) &&
        input.result.candidate.evidence.some(e => e.field === change.field && e.sourceUrl === input.result.sourceUrl)))))
      throw new Error("Impericon publication requires matching persisted official announcement evidence");
    // Inventory-only updates must carry the same persisted field/value/time
    // proof as combined artist updates; no lineup diff is needed to hit this gate.
    if (input.result.festivalSlug === "idays" && input.result.changes.some(change => ["ticketStatus", "ticketsUrl"].includes(change.field))
      && !input.result.changes.filter(change => ["ticketStatus","ticketsUrl"].includes(change.field)).every(verifiedSupplementTicketChange))
      throw new Error("I-Days ticket publication requires matching persisted official inventory evidence");
    const idaysLineup = input.result.festivalSlug === "idays" &&
      input.result.changes.some(({ field }) => field === "lineup" || field === "headliners");
    if (idaysLineup && !(isIdaysAnnouncement(input.result.candidate, applied.edition.year) &&
      candidate.festivalSlug === "idays" && candidate.attempt.requestedUrl === input.result.sourceUrl &&
      input.result.candidate.sourceUrl === input.result.sourceUrl &&
      input.result.changes.every(change => verifiedSupplementTicketChange(change) || (change.field !== "ticketStatus" &&
        (change.field !== "ticketsUrl" || change.after === "https://www.idays.it/tickets") &&
        (!["lineup", "headliners"].includes(change.field) || ["artist_added", "headliner_added"].includes(change.kind)) &&
        candidate.evidence.some(e => e.field === change.field && e.sourceUrl === input.result.sourceUrl) &&
        input.result.candidate.evidence.some(e => e.field === change.field && e.sourceUrl === input.result.sourceUrl)))))
      throw new Error("I-Days publication requires matching persisted official addition evidence");
    const graspopLineup=input.result.festivalSlug==='graspop' && input.result.changes.some(({field})=>['lineup','headliners'].includes(field));
    if(graspopLineup && !(isGraspopAnnouncement(input.result.candidate,applied.edition.year) &&
      isGraspopAnnouncement(candidate.normalized as unknown as FestivalCandidate,applied.edition.year) &&
      candidate.festivalSlug==='graspop' && candidate.attempt.requestedUrl===GRASPOP_FAQ && input.result.sourceUrl===GRASPOP_FAQ &&
      input.result.changes.every(({field,kind})=>['startDate','endDate','headliners','lineup','status'].includes(field) &&
        (field!=='headliners'||kind==='headliner_added') && (field!=='lineup'||kind==='artist_added') &&
        candidate.evidence.some(e=>e.field===field && e.sourceUrl===GRASPOP_FAQ && same(e.observedValue,(input.result.candidate as unknown as Record<string,unknown>)[field])))))throw new Error('Graspop publication requires matching persisted official addition evidence');
    const downloadLineup = input.result.festivalSlug === "download" && input.result.changes.some(({field}) => ["lineup", "headliners"].includes(field));
    const verifiedDownloadAnnouncement = candidate.festivalSlug === "download" &&
      candidate.attempt.requestedUrl === input.result.sourceUrl && input.result.sourceUrl === "https://downloadfestival.co.uk/" &&
      isDownloadAnnouncement(input.result.candidate, applied.edition.year) &&
      isDownloadAnnouncement(candidate.normalized as unknown as FestivalCandidate, applied.edition.year);
    if ((downloadLineup || input.result.changes.some(c => c.field === "completeness")) && !verifiedDownloadAnnouncement)
      throw new Error("Download publication requires verified official announcement evidence");
    const provinssiPublication = input.result.festivalSlug === 'provinssi';
    const verifiedProvinssiAnnouncement = provinssiPublication && candidate.festivalSlug === 'provinssi' &&
      candidate.attempt.requestedUrl === PROVINSSI_HOME && input.result.sourceUrl === PROVINSSI_HOME &&
      isProvinssiAnnouncement(input.result.candidate, applied.edition.year) &&
      isProvinssiAnnouncement(candidate.normalized as unknown as FestivalCandidate, applied.edition.year) &&
      input.result.changes.every(({field,kind}) => ['startDate','endDate','city','lineup','ticketsUrl','status'].includes(field) &&
        (field !== 'lineup' || kind === 'artist_added') &&
        candidate.evidence.some(e => e.field === field && e.sourceUrl === PROVINSSI_HOME &&
          same(e.observedValue, (input.result.candidate as unknown as Record<string,unknown>)[field]))) &&
      ['startDate','endDate','city','lineup','ticketsUrl','status'].every(field =>
        same((candidate.normalized as Record<string,unknown>)[field], (input.result.candidate as unknown as Record<string,unknown>)[field]));
    if (provinssiPublication && !verifiedProvinssiAnnouncement)
      throw new Error('Provinssi publication requires matching persisted official addition evidence');
    const provinssiLineup = verifiedProvinssiAnnouncement && input.result.changes.some(c => c.kind === 'artist_added');
    if((graspopLineup || verifiedDownloadAnnouncement || provinssiLineup) && applied.edition.completeness==='TBA') {
      await db.festivalEdition.update({where:{id:applied.edition.id},data:{completeness:'PARTIAL'}});
      if (!applied.changedFields.includes('completeness')) applied.changedFields.push('completeness');
    }
    const playlistRefreshDeferral = verifiedProvinssiAnnouncement || idaysLineup || graspopLineup || (downloadLineup && verifiedDownloadAnnouncement) ? {
      policy: "explicit-refresh-only", reason: `Verified ${input.result.festivalSlug==='provinssi'?'Provinssi':downloadLineup?'Download':graspopLineup?'Graspop':'I-Days'} catalog additions do not authorize provider activity`,
    } : undefined;
    const publication = await createPublication(db, {
      source: CatalogPublicationSource.INGESTION, sourceId, festivalSlug: input.result.festivalSlug,
      editionYear: applied.edition.year, actorLabel: "automatic-ingestion", fields: applied.changedFields,
      evidence: { candidateId: candidate.id, sourceCommit: input.sourceCommit, sourceUrl: input.result.sourceUrl, evidenceIds: candidate.evidence.map(({ id }) => id),
        ...(playlistRefreshDeferral ? { playlistRefresh: playlistRefreshDeferral } : {}) },
      playlistRefreshDeferral,
    });
    // The due-worker event batch is committed atomically with the catalogue.
    if (publication && input.notificationEvents?.length) {
      if (input.notificationEvents.some((event) => event.festivalId !== input.result.festivalSlug + ":" + applied.edition.year)) throw new Error("Notification edition mismatch");
      await db.ingestionNotificationOutbox.createMany({ data: uniqueNotificationEvents(input.notificationEvents).map((event) => ({
        publicationId: publication.id, dedupeKey: event.dedupeKey, event: json(event),
      })) });
    }
    await db.ingestionCandidate.update({ where: { id: candidate.id }, data: {
      reviewState: publication ? "PUBLISHED" : "SUPERSEDED", reviewActor: "automatic-ingestion",
      reviewedAt: new Date(), publishedAt: publication ? new Date() : null, catalogueVersion: publication?.id ?? null,
    } });
    return publication;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

export async function publishAdminFestivalChange(db: Prisma.TransactionClient, input: {
  change: { id: string; resourceKey: string; field: string; beforeValue: unknown; afterValue: unknown; sourceEvidence: unknown; parserRunId: string | null };
  actorLabel: string;
}) {
  assertAdminArtistReviewAllowed(input.change.resourceKey, [input.change.field]);
  const sourceId = `admin:${input.change.id}`;
  const existing = await db.catalogPublication.findUnique({ where: { sourceId } });
  if (existing) return { ...existing, playlistRefreshRequested: existing.lineupChanged };
  const afterValue = input.change.field === "lineup" || input.change.field === "headliners"
    ? stringList(input.change.afterValue, input.change.field)
    : input.change.afterValue;
  const applied = await applyFestivalChanges(db, {
    festivalSlug: input.change.resourceKey,
    changes: [{ field: input.change.field, before: input.change.beforeValue, after: afterValue }],
    strictBefore: Boolean(input.change.parserRunId), observedAt: new Date(),
  });
  return createPublication(db, {
    source: CatalogPublicationSource.ADMIN, sourceId, festivalSlug: input.change.resourceKey,
    editionYear: applied.edition.year, actorLabel: input.actorLabel, fields: applied.changedFields,
    evidence: { adminChangeId: input.change.id, sourceEvidence: input.change.sourceEvidence },
  });
}

/** Authenticated agent review: caller holds the issue/source lease and has
 * compared the exact current snapshot. No weakening of the automatic parser
 * policy, and no provider activity is implied by resolving an import conflict. */
export async function publishAgentFestivalResolution(
  db: Prisma.TransactionClient,
  input: {
    editionId: string;
    festivalSlug: string;
    sourceId: string;
    reason: string;
    facts: NonNullable<AgentDecision["facts"]>;
    evidence: AgentDecision["evidence"];
    observedAt: Date;
  },
) {
  const replay = await db.catalogPublication.findUnique({
    where: { sourceId: input.sourceId },
  });
  if (replay) return { ...replay, playlistRefreshRequested: false };
  const edition = await db.festivalEdition.findUniqueOrThrow({
    where: { id: input.editionId },
    include: {
      festival: true,
      lineup: { include: { artist: true }, orderBy: { position: "asc" } },
    },
  });
  if (
    edition.festival.slug !== input.festivalSlug ||
    edition.recordState !== "CURRENT"
  )
    throw new Error("Reviewed edition mismatch");
  const dateProblem = editionDateProblem(edition.year,
    input.facts.startDate ?? isoDate(edition.startDate), input.facts.endDate ?? isoDate(edition.endDate));
  if (dateProblem) throw new Error(`Reviewed dates mismatch: ${dateProblem}`);
  // Only a genuinely new edition's first reviewed roster enters the native
  // provider queue. Existing/cancelled rosters and prior generations stay gated.
  const initialPlaylistGeneration =
    edition.lineup.length === 0 &&
    ((input.facts.headliners?.length ?? 0) + (input.facts.lineup?.length ?? 0) > 0) &&
    (input.facts.status ? input.facts.status !== "tba" : edition.status !== "TBA") &&
    !["full-rewind", "area53"].includes(input.festivalSlug) &&
    await db.festivalPlaylist.count({ where: { editionId: edition.id } }) === 0 &&
    await db.catalogPublication.count({ where: {
      festivalSlug: input.festivalSlug, editionYear: edition.year, lineupChanged: true,
    } }) === 0;
  const ensureArtist = artistResolver(db, input.observedAt);
  const changedFields: string[] = [];
  if (
    input.facts.headliners !== undefined &&
    input.facts.lineup !== undefined
  ) {
    const headliners = stringList(input.facts.headliners, "headliners"),
      lineup = stringList(input.facts.lineup, "lineup");
    if (
      new Set([...headliners, ...lineup].map((n) => n.toLocaleLowerCase()))
        .size !==
      headliners.length + lineup.length
    )
      throw new Error("Ambiguous reviewed billing");
    const oldHeadliners = edition.lineup
      .filter((l) => l.billing === "HEADLINER" && l.status === "ANNOUNCED")
      .map((l) => l.artist.name);
    const oldLineup = edition.lineup
      .filter((l) => l.billing === "LINEUP" && l.status === "ANNOUNCED")
      .map((l) => l.artist.name);
    if (!same(oldHeadliners, headliners) || !same(oldLineup, lineup)) {
      const artists = [];
      for (const name of [...headliners, ...lineup])
        artists.push(await ensureArtist(name));
      const cancelled = edition.lineup.filter((l) => l.status === "CANCELLED");
      if (artists.some((a) => cancelled.some((l) => l.artistId === a.id)))
        throw new Error("Cancellation requires separate explicit review");
      // Replace both billing classes together so promotion/demotion cannot
      // collide with an artist temporarily present in the opposite class.
      await db.lineupEntry.deleteMany({
        where: { editionId: edition.id, status: "ANNOUNCED" },
      });
      for (const [billing, names, offset] of [
        ["HEADLINER", headliners, 0],
        ["LINEUP", lineup, headliners.length],
      ] as const) {
        const occupied = new Set(
          cancelled.filter((l) => l.billing === billing).map((l) => l.position),
        );
        let position = 0;
        for (let n = 0; n < names.length; n++) {
          while (occupied.has(position)) position++;
          await db.lineupEntry.create({
            data: {
              editionId: edition.id,
              artistId: artists[offset + n].id,
              billing,
              position: position++,
              status: "ANNOUNCED",
            },
          });
        }
      }
      changedFields.push("headliners", "lineup");
      await db.festivalEdition.updateMany({
        where: { id: edition.id, sourceUpdatedAt: { lt: input.observedAt } },
        data: { sourceUpdatedAt: input.observedAt },
      });
    }
  }
  const scalar = Object.entries(input.facts)
    .filter(([field]) => field !== "headliners" && field !== "lineup")
    .map(([field, after]) => ({ field, after }));
  if (scalar.length) {
    const applied = await applyFestivalChanges(db, {
      festivalSlug: input.festivalSlug,
      expectedYear: edition.year,
      changes: scalar,
      strictBefore: false,
      observedAt: input.observedAt,
    });
    changedFields.push(...applied.changedFields);
  }
  if (input.facts.status) {
    const completeness = {
      confirmed: "COMPLETE",
      partial: "PARTIAL",
      tba: "TBA",
    } as const;
    if (edition.completeness !== completeness[input.facts.status]) {
      await db.festivalEdition.update({
        where: { id: edition.id },
        data: { completeness: completeness[input.facts.status] },
      });
      changedFields.push("completeness");
    }
  }
  for (const field of [...new Set(changedFields)]) {
    const evidence = input.evidence.find(
      (e) =>
        e.field === field || (field === "completeness" && e.field === "status"),
    );
    if (!evidence) throw new Error("Reviewed field has no official evidence");
    await db.editionProvenance.create({
      data: {
        editionId: edition.id,
        field,
        url: evidence.url,
        checkedAt: new Date(evidence.checkedAt),
        note: evidence.excerpt,
      },
    });
  }
  return createPublication(db, {
    source: CatalogPublicationSource.ADMIN,
    sourceId: input.sourceId,
    festivalSlug: input.festivalSlug,
    editionYear: edition.year,
    actorLabel: "openclaw-import-agent",
    fields: [...new Set(changedFields)],
    evidence: {
      reason: input.reason,
      officialEvidence: input.evidence,
      reviewPolicy: "openclaw-import-conflicts-v1",
      providerPolicy: initialPlaylistGeneration ? "initial-lineup-generation" : "explicit-refresh-only",
    },
    playlistRefreshDeferral: initialPlaylistGeneration ? undefined : {
      policy: "explicit-refresh-only",
      reason:
        "Import conflict resolution is not a request to refresh existing provider playlists",
    },
  });
}
