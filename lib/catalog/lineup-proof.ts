import { createHash } from "node:crypto";

type RosterEntry = { id: string; artistId: string; billing: string; status: string };

// Bind the review to an edition and the roster it attests to. Display order
// and artist spelling corrections do not change the verified membership.
export function rosterFingerprint(editionId: string, entries: readonly RosterEntry[]) {
  const roster = entries.map(({ id, artistId, billing, status }) =>
    JSON.stringify([id, artistId, billing, status])).sort();
  return createHash("sha256").update(JSON.stringify([editionId, roster])).digest("hex");
}
