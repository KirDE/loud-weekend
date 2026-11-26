import { artistOrthographyKey } from "../catalog/artist-orthography.ts";
import type { Festival } from "../domain/festival.ts";
import type { FestivalCandidate, FestivalChange } from "./types.ts";

function scalarChange(
  changes: FestivalChange[],
  field: "startDate" | "endDate" | "city" | "ticketsUrl" | "status",
  before: string | undefined,
  after: string | undefined,
) {
  if (after === undefined || before === after) return;
  const kind =
    field === "city"
      ? "city_changed"
      : field === "ticketsUrl"
        ? "tickets_changed"
        : field === "status"
          ? "status_changed"
          : "date_changed";
  changes.push({
    kind,
    field,
    before,
    after,
    reviewRequired: (field === "startDate" || field === "endDate") && before !== undefined,
  });
}

// Formatting equivalence is safe only for one-to-one names across BOTH billing groups.
// Fall back to literal names when either roster has competing spellings.
function ambiguousOrthography(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = artistOrthographyKey(name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key);
}
function identityKey(name: string, ambiguous: Set<string>) {
  const key = artistOrthographyKey(name);
  return JSON.stringify(
    ambiguous.has(key) ? ["literal", name.toLocaleLowerCase()] : ["orthography", key],
  );
}

function listChanges(
  changes: FestivalChange[],
  field: "lineup" | "headliners",
  before: string[],
  after: string[] | undefined,
  additive = false,
  ambiguous = new Set<string>(),
) {
  if (!after) return;
  const oldNames = new Map(before.map((name) => [identityKey(name, ambiguous), name]));
  const newNames = new Map(after.map((name) => [identityKey(name, ambiguous), name]));
  for (const [key, name] of newNames)
    if (!oldNames.has(key))
      changes.push({
        kind: field === "headliners" ? "headliner_added" : "artist_added",
        field,
        after: name,
        reviewRequired: false,
      });
  for (const [key, name] of oldNames)
    if (!additive && !newNames.has(key))
      changes.push({
        kind: field === "headliners" ? "headliner_removed" : "artist_removed",
        field,
        before: name,
        reviewRequired: true,
        reason: "Removals require confirmation",
      });
}

function operationalChanges(
  changes: FestivalChange[],
  current: Festival,
  candidate: FestivalCandidate,
) {
  if (candidate.ticketStatus && candidate.ticketStatus !== current.ticketStatus) {
    changes.push({
      kind: "ticket_status_changed",
      field: "ticketStatus",
      before: current.ticketStatus,
      after: candidate.ticketStatus,
      reviewRequired: false,
    });
  }
  if (candidate.timetable?.length && !current.timetable?.length) {
    changes.push({
      kind: "timetable_published",
      field: "timetable",
      after: `${candidate.timetable.length}`,
      reviewRequired: true,
      reason: "Timetables require provenance-aware reviewed import",
    });
  }
}

export function diffFestival(current: Festival, candidate: FestivalCandidate): FestivalChange[] {
  const changes: FestivalChange[] = [];
  // Only replacement snapshots assert a complete roster. Additive/announcement
  // sources retain literal matching and their existing billing/provider gates.
  const snapshot =
    candidate.artistListMode !== "additive" && candidate.lineupScope !== "announcement";
  const ambiguous = new Set([
    ...ambiguousOrthography([...current.headliners, ...current.lineup]),
    ...ambiguousOrthography([...(candidate.headliners ?? []), ...(candidate.lineup ?? [])]),
    ...(!snapshot
      ? [
          ...current.headliners,
          ...current.lineup,
          ...(candidate.headliners ?? []),
          ...(candidate.lineup ?? []),
        ].map(artistOrthographyKey)
      : []),
  ]);
  scalarChange(changes, "startDate", current.startDate, candidate.startDate);
  scalarChange(changes, "endDate", current.endDate, candidate.endDate);
  scalarChange(changes, "city", current.city, candidate.city);
  scalarChange(changes, "ticketsUrl", current.ticketsUrl, candidate.ticketsUrl);
  scalarChange(
    changes,
    "status",
    current.status,
    candidate.lineupScope === "announcement" && current.status === "confirmed"
      ? undefined
      : candidate.status,
  );
  listChanges(
    changes,
    "headliners",
    current.headliners,
    candidate.headliners,
    candidate.artistListMode === "additive",
    ambiguous,
  );
  const announcement = candidate.lineupScope === "announcement";
  const headliners = new Set(current.headliners.map((name) => identityKey(name, ambiguous)));
  listChanges(
    changes,
    "lineup",
    current.lineup,
    announcement
      ? candidate.lineup?.filter((name) => !headliners.has(identityKey(name, ambiguous)))
      : candidate.lineup,
    announcement || candidate.artistListMode === "additive",
    ambiguous,
  );
  // New artists from these announcement adapters require protected review.
  // An unchanged additive replay must not generate another review.
  if (["summer-punch", "area53", "tolminator"].includes(candidate.festivalSlug))
    for (const change of changes) {
      if (change.kind === "artist_added" || change.kind === "headliner_added") {
        change.reviewRequired = true;
        const label =
          candidate.festivalSlug === "area53"
            ? "Area 53"
            : candidate.festivalSlug === "tolminator"
              ? "Tolminator"
              : "Summer Punch";
        change.reason = `${label} additions require protected ingestion review`;
      }
    }
  operationalChanges(changes, current, candidate);
  return changes;
}
