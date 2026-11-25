import { createHash } from "node:crypto";

type RosterEntry = { artistId: string; billing: string; status: string };

// Bind the review to an edition and the roster it attests to. Display order
// and artist spelling corrections do not change the verified membership.
export function rosterFingerprint(editionId: string, entries: readonly RosterEntry[]) {
  const roster = entries
    .map(({ artistId, billing, status }) => JSON.stringify([artistId, billing, status]))
    .sort();
  return createHash("sha256")
    .update(JSON.stringify([editionId, roster]))
    .digest("hex");
}
