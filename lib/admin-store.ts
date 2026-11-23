import { assertAdminArtistReviewAllowed } from "@/lib/catalog/admin-artist-review";
import { AdminChangeStatus, AdminDraftStatus, AdminResourceKind, AdminRunStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mapSource } from "@/lib/sources/repository";
import { claimDueSources, completeSourceLease, releaseOwnedSourceLease } from "@/lib/ingestion/lease";
import { evaluateCandidate } from "@/lib/ingestion/policy";
import type { Festival } from "@/lib/domain/festival";
import { fetchSource } from "@/lib/ingestion/fetch";
import { db } from "@/lib/db";
import { publishAdminFestivalChange } from "@/lib/catalog/publication";
import { readCatalog } from "@/lib/catalog/repository";
import { extractFestivalCandidate } from "@/lib/ingestion/extract";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const kind = (value: string) => AdminResourceKind[value.toUpperCase() as keyof typeof AdminResourceKind];

export async function adminSnapshot() {
  const [drafts, resources, changes, runs, audit, submissions, sourceHealth] = await Promise.all([
    db.adminDraft.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
    db.adminResourceState.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
    db.adminChange.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.adminParserRun.findMany({ orderBy: { startedAt: "desc" }, take: 100 }),
    db.adminAuditEntry.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.festivalSubmission.findMany({ include: { audit: { orderBy: { createdAt: "asc" } } }, orderBy: { submittedAt: "desc" }, take: 100 }),
    db.festivalSource.findMany({ select: { id: true, festivalSlug: true, consecutiveFailures: true, failureStartedAt: true, deprecatedAt: true, nextRunAt: true }, orderBy: { festivalSlug: "asc" }, take: 1000 }),
  ]);
  return { drafts, resources, changes, runs, audit, submissions, sourceHealth };
}

export async function parserRunLog(id: string) {
  if (!id) throw new Error("Parser run not found");
  const run = await db.adminParserRun.findUnique({
    where: { id },
    select: { id: true, festivalSlug: true, status: true, startedAt: true, finishedAt: true, log: true },
  });
  if (!run) throw new Error("Parser run not found");
  return run;
}

export async function decideSubmission(reference: string, decision: "approve" | "reject", reviewNote: string, actor: { id: string; email: string }) {
  return db.$transaction(async (tx) => {
    const submission = await tx.festivalSubmission.findUnique({ where: { publicReference: reference } });
    if (!submission || submission.status !== "PENDING") throw new Error("Submission is not pending");
    const status = decision === "approve" ? "APPROVED" : "REJECTED";
    const changed = await tx.festivalSubmission.updateMany({ where: { id: submission.id, status: "PENDING" }, data: { status, reviewedAt: new Date(), reviewedById: actor.id, reviewNote: reviewNote || null } });
    if (changed.count !== 1) throw new Error("Submission was reviewed concurrently");
    await tx.festivalSubmissionAudit.create({ data: { submissionId: submission.id, actorId: actor.id, action: status, detail: { actor: actor.email, reviewNote: reviewNote || null } } });
    return tx.festivalSubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { audit: { orderBy: { createdAt: "asc" } } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function saveDraft(input: { resourceKind: string; resourceKey: string; baseRevision: number; values: unknown }, actor: { id: string; email: string }) {
  const resourceKind = kind(input.resourceKind);
  if (!resourceKind || !input.resourceKey || !Number.isInteger(input.baseRevision) || typeof input.values !== "object" || !input.values) throw new Error("Invalid draft");
  return db.$transaction(async (tx) => {
    const resource = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind, resourceKey: input.resourceKey } } });
    const currentRevision = resource?.revision ?? 0;
    if (input.baseRevision !== currentRevision) throw new Error(`Revision conflict: expected ${currentRevision}`);
    const values = input.values as Record<string, unknown>;
    if (!Object.keys(values).length) throw new Error("Draft has no fields");
    const draft = await tx.adminDraft.create({ data: { resourceKind, resourceKey: input.resourceKey, baseRevision: currentRevision, revision: currentRevision + 1, status: AdminDraftStatus.QUEUED, values: json(values), validation: json({ valid: true, checkedAt: new Date().toISOString() }), createdById: actor.id } });
    const before = resource?.values && typeof resource.values === "object" && !Array.isArray(resource.values) ? resource.values as Record<string, unknown> : {};
    await tx.adminChange.createMany({ data: Object.entries(values).map(([field, afterValue]) => ({ resourceKind, resourceKey: input.resourceKey, field, baseRevision: currentRevision, beforeValue: json(before[field] ?? null), afterValue: json(afterValue ?? null), sourceEvidence: json({ kind: "operator-draft", draftId: draft.id }), confidence: 100, draftId: draft.id })) });
    await tx.adminAuditEntry.create({ data: { actorId: actor.id, actorLabel: actor.email, action: "DRAFT_SAVED", resourceKind, resourceKey: input.resourceKey, afterValue: json(input.values), metadata: json({ revision: draft.revision }) } });
    return draft;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateDraft(id: string, valuesInput: unknown, actor: { id: string; email: string }) {
  if (typeof valuesInput !== "object" || !valuesInput || Array.isArray(valuesInput) || !Object.keys(valuesInput).length) throw new Error("Draft has no fields");
  return db.$transaction(async (tx) => {
    const draft = await tx.adminDraft.findUnique({ where: { id }, include: { queuedChanges: true } });
    if (!draft || draft.createdById !== actor.id) throw new Error("Draft not found");
    if (draft.queuedChanges.some((change) => change.status !== AdminChangeStatus.PENDING)) throw new Error("Decided drafts cannot be edited");
    const resource = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind: draft.resourceKind, resourceKey: draft.resourceKey } } });
    if ((resource?.revision ?? 0) !== draft.baseRevision) throw new Error(`Revision conflict: expected ${resource?.revision ?? 0}`);
    const values = valuesInput as Record<string, unknown>;
    const before = resource?.values && typeof resource.values === "object" && !Array.isArray(resource.values) ? resource.values as Record<string, unknown> : {};
    await tx.adminChange.deleteMany({ where: { draftId: id } });
    await tx.adminChange.createMany({ data: Object.entries(values).map(([field, afterValue]) => ({ resourceKind: draft.resourceKind, resourceKey: draft.resourceKey, field, baseRevision: draft.baseRevision, beforeValue: json(before[field] ?? null), afterValue: json(afterValue ?? null), sourceEvidence: json({ kind: "operator-draft", draftId: id }), confidence: 100, draftId: id })) });
    const updated = await tx.adminDraft.update({ where: { id }, data: { values: json(values), validation: json({ valid: true, checkedAt: new Date().toISOString() }) } });
    await tx.adminAuditEntry.create({ data: { actorId: actor.id, actorLabel: actor.email, action: "DRAFT_UPDATED", resourceKind: draft.resourceKind, resourceKey: draft.resourceKey, afterValue: json(values), metadata: json({ draftId: id }) } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteDraft(id: string, actor: { id: string; email: string }) {
  return db.$transaction(async (tx) => {
    const draft = await tx.adminDraft.findUnique({ where: { id }, include: { queuedChanges: true } });
    if (!draft || draft.createdById !== actor.id) throw new Error("Draft not found");
    if (draft.queuedChanges.some((change) => change.status !== AdminChangeStatus.PENDING)) throw new Error("Decided drafts cannot be deleted");
    await tx.adminChange.deleteMany({ where: { draftId: id } });
    await tx.adminDraft.delete({ where: { id } });
    await tx.adminAuditEntry.create({ data: { actorId: actor.id, actorLabel: actor.email, action: "DRAFT_DELETED", resourceKind: draft.resourceKind, resourceKey: draft.resourceKey, beforeValue: json(draft.values), metadata: json({ draftId: id }) } });
    return { deleted: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function decideChange(id: string, decision: "approve" | "reject", actor: { id: string; email: string }) {
  return db.$transaction(async (tx) => {
    const change = await tx.adminChange.findUnique({ where: { id } });
    if (!change || change.status !== AdminChangeStatus.PENDING) throw new Error("Change is no longer pending");
    const resource = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind: change.resourceKind, resourceKey: change.resourceKey } } });
    const currentRevision = resource?.revision ?? 0;
    if (decision === "approve" && currentRevision !== change.baseRevision) {
      await tx.adminChange.update({ where: { id }, data: { status: AdminChangeStatus.CONFLICT } });
      throw new Error(`Revision conflict: expected ${currentRevision}`);
    }
    const status = decision === "approve" ? AdminChangeStatus.APPROVED : AdminChangeStatus.REJECTED;
    const updated = await tx.adminChange.updateMany({ where: { id, status: AdminChangeStatus.PENDING }, data: { status, decidedById: actor.id, decidedAt: new Date() } });
    if (updated.count !== 1) throw new Error("Change was decided concurrently");
    const catalogFestival = change.resourceKind === AdminResourceKind.FESTIVAL
      ? true
      : change.resourceKind === AdminResourceKind.LINK
        ? Boolean(await tx.festival.findUnique({ where: { slug: change.resourceKey }, select: { id: true } }))
        : false;
    const catalogPublication = decision === "approve" && catalogFestival
      ? await publishAdminFestivalChange(tx, { change, actorLabel: actor.email })
      : null;
    if (decision === "approve") {
      const existing = resource?.values && typeof resource.values === "object" && !Array.isArray(resource.values) ? resource.values as Record<string, unknown> : {};
      await tx.adminResourceState.upsert({ where: { resourceKind_resourceKey: { resourceKind: change.resourceKind, resourceKey: change.resourceKey } }, create: { resourceKind: change.resourceKind, resourceKey: change.resourceKey, revision: currentRevision + 1, values: json({ ...existing, [change.field]: change.afterValue }) }, update: { revision: { increment: 1 }, values: json({ ...existing, [change.field]: change.afterValue }) } });
      if (change.draftId) await tx.adminChange.updateMany({ where: { draftId: change.draftId, status: AdminChangeStatus.PENDING, NOT: { id } }, data: { baseRevision: currentRevision + 1 } });
    }
    const refresh = change.parserRunId ? change.sourceEvidence as { kind?: string; editionId?: string } | null : null;
    // Proposals at the same revision and edition can share a review even if
    // re-observed on different runs. Canonical publication still checks each before-value.
    if (decision === "approve" && refresh && refresh.kind === "scoped-refresh" && refresh.editionId) {
      await tx.adminChange.updateMany({
        where: {
          resourceKind: change.resourceKind, resourceKey: change.resourceKey, status: AdminChangeStatus.PENDING,
          baseRevision: currentRevision, field: { not: change.field },
          parserRunId: { not: null },
          AND: [
            { sourceEvidence: { path: ["kind"], equals: "scoped-refresh" } },
            { sourceEvidence: { path: ["editionId"], equals: refresh.editionId } },
          ],
        },
        data: { baseRevision: currentRevision + 1 },
      });
    }
    if (change.draftId) {
      const pending = await tx.adminChange.count({ where: { draftId: change.draftId, status: AdminChangeStatus.PENDING, NOT: { id } } });
      if (!pending) await tx.adminDraft.update({ where: { id: change.draftId }, data: { status: decision === "approve" ? AdminDraftStatus.APPLIED : AdminDraftStatus.REJECTED } });
    }
    await tx.adminAuditEntry.create({ data: { actorId: actor.id, actorLabel: actor.email, action: decision === "approve" ? "CHANGE_APPROVED" : "CHANGE_REJECTED", resourceKind: change.resourceKind, resourceKey: change.resourceKey, beforeValue: json(change.beforeValue), afterValue: json(change.afterValue), evidence: json(change.sourceEvidence), metadata: json({ changeId: change.id, field: change.field, catalogPublicationId: catalogPublication?.id ?? null, playlistRefreshRequested: catalogPublication?.playlistRefreshRequested ?? false }) } });
    const decided = await tx.adminChange.findUniqueOrThrow({ where: { id } });
    return { ...decided, catalogPublicationId: catalogPublication?.id ?? null, playlistRefreshRequested: catalogPublication?.playlistRefreshRequested ?? false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export class FestivalRefreshError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type RefreshActor = { id: string; email: string };

async function refreshSource(refreshId: string, sourceId: string, editionId: string, festival: Festival, actor: RefreshActor,
    aliases: Awaited<ReturnType<typeof readAliases>>) {
  const owner = randomUUID();
  const [claim] = await claimDueSources(db, {
    owner, now: new Date(), limit: 1, ttlMs: 30 * 60_000,
    manualSource: { sourceId, editionId },
  });
  if (!claim) return { status: "skipped" as const };

  const lease = { ...claim, owner };
  let runId: string | undefined;
  let httpStatus: number | undefined;
  let stage: "pre_attempt_error" | "fetch_error" | "parser_error" | "post_attempt_error" = "pre_attempt_error";
  try {
    // The selected configuration may have changed between the query and claim.
    const row = await db.festivalSource.findUniqueOrThrow({
      where: { id: sourceId }, include: { edition: { select: { festivalId: true, year: true } } },
    });
    if (row.updatedAt.getTime() !== claim.updatedAt.getTime() || row.editionId !== editionId)
      throw new Error("Source changed during refresh");
    const active = mapSource(row);
    const run = await db.adminParserRun.create({ data: {
      festivalSlug: festival.slug, sourceId: active.id, adapter: active.strategies.join(","),
      requestedById: actor.id, log: json([{ at: new Date().toISOString(), message: "Fetch started" }]),
    } });
    runId = run.id;
    stage = "fetch_error";
    const { response } = await fetchSource(active);
    if (!response.ok) {
      httpStatus = response.status;
      throw new Error("Source HTTP failure");
    }
    const html = await response.text();
    stage = "parser_error";
    const candidate = extractFestivalCandidate(html, active, new Date().toISOString());
    const result = evaluateCandidate(festival, candidate, aliases);
    if (!candidate.evidence.length) throw new Error("Official source provided no supported evidence");
    if (candidate.observedEditionYears.some((year) => year !== active.editionYear))
      throw new Error("Official source returned another edition");
    const reviewReasons = [...result.reviewReasons];
    const fields = {
      startDate: "Start date",
      endDate: "End date",
      city: "City",
      headliners: "Headliners",
      lineup: "Lineup",
      ticketsUrl: "Ticket URL",
      ticketStatus: "Ticket availability",
      status: "Status",
    } as const;
    const proposals = (Object.keys(fields) as (keyof typeof fields)[]).flatMap((field) => {
      const differences = result.changes.filter((item) => item.field === field);
      const evidence = candidate.evidence.filter((item) => item.field === field);
      if (!differences.length || !evidence.length) return [];
      const observedYears = candidate.fieldEditionYears?.[field] ?? candidate.observedEditionYears;
      if (!observedYears.includes(active.editionYear)) {
        reviewReasons.push(`${fields[field]} could not be verified for the selected edition.`);
        return [];
      }
      const afterValue = field === "lineup" || field === "headliners"
        ? [...festival[field].filter((name) => !differences.some((diff) => diff.before === name)),
            ...differences.flatMap((diff) => diff.after === undefined ? [] : [diff.after])]
        : differences[0].after;
      if (afterValue === undefined) return [];
      return [{
        field, beforeValue: festival[field] === undefined ? Prisma.JsonNull : json(festival[field]), afterValue: json(afterValue), confidence: 90,
        sourceEvidence: json({ kind: "scoped-refresh", refreshId, editionId, editionYear: active.editionYear, evidence }),
      }];
    });
    assertAdminArtistReviewAllowed(festival.slug, proposals.map(({ field }) => field));
    stage = "post_attempt_error";
    const saved = await db.$transaction(async (tx) => {
      const finishedAt = new Date();
      const bound = await tx.festivalEdition.findFirst({
        where: { id: editionId, year: active.editionYear, recordState: "CURRENT" }, select: { id: true },
      });
      if (!bound || !await completeSourceLease(tx, { ...lease, now: finishedAt, outcome: "success" }))
        throw new Error("Source or edition changed before recording the refresh");
      const resourceKind = AdminResourceKind.FESTIVAL;
      const resourceKey = festival.slug;
      const resource = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind, resourceKey } } });
      const baseRevision = resource?.revision ?? 0;
      let queued = 0;
      for (const proposal of proposals) {
        const duplicate = await tx.adminChange.findFirst({ where: {
          resourceKind, resourceKey, field: proposal.field, baseRevision, status: "PENDING",
          beforeValue: { equals: proposal.beforeValue }, afterValue: { equals: proposal.afterValue },
          parserRunId: { not: null },
          AND: [
            { sourceEvidence: { path: ["kind"], equals: "scoped-refresh" } },
            { sourceEvidence: { path: ["editionId"], equals: editionId } },
          ],
        } });
        if (duplicate) continue;
        await tx.adminChange.create({ data: { ...proposal, resourceKind, resourceKey, baseRevision, parserRunId: run.id } });
        queued++;
      }
      const updated = await tx.adminParserRun.update({ where: { id: run.id }, data: {
        status: reviewReasons.length ? AdminRunStatus.PARTIAL : AdminRunStatus.SUCCEEDED,
        finishedAt, durationMs: finishedAt.getTime() - run.startedAt.getTime(), extracted: candidate.evidence.length,
        message: `${queued} change(s) queued`, log: json([
          { at: run.startedAt.toISOString(), message: "Fetch started" },
          { at: finishedAt.toISOString(), message: "Parse completed", reviewReasons, queued },
        ]),
      } });
      await tx.adminAuditEntry.create({ data: {
        actorId: actor.id, actorLabel: actor.email, action: "FESTIVAL_REFRESHED", resourceKind, resourceKey,
        metadata: json({ runId: run.id, sourceId: active.id, editionYear: active.editionYear, queued }),
      } });
      return { id: updated.id, queued, result: updated.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { status: "checked" as const, ...saved };
  } catch {
    if (runId) {
      const message = httpStatus === undefined ? stage : `Source returned HTTP ${httpStatus}`;
      await db.adminParserRun.update({ where: { id: runId }, data: {
        status: AdminRunStatus.FAILED, finishedAt: new Date(), message,
        log: json([{ at: new Date().toISOString(), message }]),
      } });
    }
    await completeSourceLease(db, { ...lease, now: new Date(), outcome: stage });
    return { status: "failed" as const, id: runId };
  } finally {
    await releaseOwnedSourceLease(db, lease);
  }
}

function readAliases() {
  return db.artist.findMany({ select: { id: true, slug: true, name: true, aliases: true } });
}

export async function refreshFestival(slug: string, actor: RefreshActor, editionYear?: number) {
  const editions = await db.festivalEdition.findMany({
    where: { festival: { slug }, year: editionYear, recordState: "CURRENT" },
    select: { id: true, year: true },
  });
  if (editions.length !== 1) throw new FestivalRefreshError("Select one current festival edition.", 404);
  const [edition] = editions;
  const sources = await db.festivalSource.findMany({
    where: { festivalSlug: slug, enabled: true, editionId: edition.id, editionYear: edition.year, configurationBackfilledAt: { not: null } },
    select: { id: true }, orderBy: { id: "asc" },
  });
  if (!sources.length) throw new FestivalRefreshError("No enabled sources are configured for this edition.", 409);
  const [catalog, aliases] = await Promise.all([readCatalog(), readAliases()]);
  const festival = catalog.festivals.find((item) => item.slug === slug && item.editionYear === edition.year);
  if (!festival) throw new FestivalRefreshError("The festival edition changed during refresh.", 409);
  const refreshId = randomUUID();
  const results = [];
  for (const { id } of sources) results.push(await refreshSource(refreshId, id, edition.id, festival, actor, aliases));
  const checked = results.filter((result) => result.status === "checked");
  const failed = results.filter((result) => result.status === "failed");
  const skipped = results.length - checked.length - failed.length;
  if (!checked.length && !failed.length) throw new FestivalRefreshError("All sources are busy or waiting for their next retry.", 409);
  if (!checked.length) throw new FestivalRefreshError("All attempted sources failed. See parser runs for details.", 502);
  const queued = checked.reduce((total, result) => total + result.queued, 0);
  const status = failed.length || skipped || checked.some((result) => result.result === "PARTIAL") ? "PARTIAL" : "SUCCEEDED";
  return { id: checked[0].id, status, editionYear: edition.year, checked: checked.length, failed: failed.length, skipped, queued,
    message: `${queued} change(s) queued · ${checked.length} checked · ${failed.length} failed · ${skipped} skipped` };
}
