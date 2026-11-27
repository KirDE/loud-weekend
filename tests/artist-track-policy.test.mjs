import assert from "node:assert/strict";
import test from "node:test";
import {
  spotifyTrackPoliciesForArtists,
  trackPolicyKey,
} from "../lib/catalog/spotify-repertoire.ts";
import {
  activateArtistTrackPolicyMigration,
  publishArtistTrackPolicy,
} from "../lib/catalog/artist-track-policy-repository.ts";
import { selectionArtists, festivalSpotifyArtists } from "../lib/catalog/selection-artists.ts";

const policy = {
  schemaVersion: 1,
  excluded: false,
  reviewedOriginal: true,
  blockedPrimaryNames: ["Other Artist"],
  blockedVersionHints: ["Other Version"],
};
const edition = { festivalSlug: "fixture", editionYear: 2027 };
const artist = {
  id: "fixture-id",
  slug: "act",
  name: "Act",
  aliases: ["Billing"],
  identityState: "UNRESOLVED",
  identities: [],
  links: [],
};
const ready = {
  key: "spotify-track-policy-migration:v1",
  payload: { schemaVersion: 1, ready: true },
};
function fixture(rows = []) {
  const audit = [];
  const db = {
    artist: { findMany: async () => [artist], findUnique: async () => artist },
    festivalEdition: { findFirst: async () => ({ id: "edition" }) },
    operationalState: {
      findMany: async ({ where }) =>
        typeof where.key === "string" ? [ready] : rows.filter((r) => where.key.in.includes(r.key)),
      findUnique: async ({ where }) => rows.find((r) => r.key === where.key) ?? null,
      create: async ({ data }) => rows.push(data),
    },
    adminAuditEntry: { create: async ({ data }) => audit.push(data) },
    $transaction: async (fn) => fn(db),
  };
  return { db, rows, audit };
}
test("same canonical aliases transport restrictions to festival and personal paths", async () => {
  const { db } = fixture([{ key: trackPolicyKey("act"), payload: policy }]);
  const result = await selectionArtists(db, ["Billing"]);
  assert.deepEqual(result[0].trackPolicy, policy);
  assert.equal(result[0].name, "Act");
  assert.deepEqual(
    (await festivalSpotifyArtists(db, ["Billing"])).spotifyTrackPolicies.Billing,
    policy,
  );
  assert.equal((await selectionArtists(db, ["Unknown"]))[0].trackPolicy, undefined);
});
test("scoped overrides isolate editions and malformed overrides fail closed", async () => {
  const scoped = { ...policy, excluded: true };
  const { db, rows } = fixture([
    { key: trackPolicyKey("act"), payload: policy },
    { key: trackPolicyKey("act", edition), payload: scoped },
  ]);
  assert.deepEqual((await spotifyTrackPoliciesForArtists(db, [artist], edition)).Act, scoped);
  for (const context of [
    undefined,
    { ...edition, editionYear: 2028 },
    { ...edition, festivalSlug: "other" },
  ])
    assert.deepEqual((await spotifyTrackPoliciesForArtists(db, [artist], context)).Act, policy);
  rows[1].payload = { excluded: true };
  await assert.rejects(spotifyTrackPoliciesForArtists(db, [artist], edition));
});
test("audited preview/apply/replay/conflict and missing edition reject without widening", async () => {
  const { db, rows, audit } = fixture();
  const input = {
    slug: "act",
    policy,
    edition,
    actorLabel: "fixture",
    evidence: "Verified fixture",
    sourceUrls: ["https://example.test/evidence"],
  };
  assert.equal((await publishArtistTrackPolicy(db, input)).applied, false);
  assert.equal(rows.length, 0);
  assert.equal((await publishArtistTrackPolicy(db, input, true)).applied, true);
  assert.equal(audit.length, 1);
  assert.equal((await publishArtistTrackPolicy(db, input, true)).existing, true);
  assert.equal(audit.length, 1);
  await assert.rejects(
    publishArtistTrackPolicy(
      db,
      {
        ...input,
        policy: { ...policy, excluded: true },
      },
      true,
    ),
    /conflict/,
  );
  db.festivalEdition.findFirst = async () => null;
  await assert.rejects(publishArtistTrackPolicy(db, input, true), /current edition/);
  assert.equal(rows.length, 1);
});

test("cutover blocks both discovery entrypoints before readiness, including malformed markers", async () => {
  const { db } = fixture();
  for (const rows of [[], [{ ...ready, payload: { schemaVersion: 1, ready: false } }]]) {
    db.operationalState.findMany = async () => rows;
    await assert.rejects(selectionArtists(db, ["Billing"]), /migration has not been verified/);
    await assert.rejects(
      festivalSpotifyArtists(db, ["Billing"]),
      /migration has not been verified/,
    );
  }
});
test("cutover verifies required policies, audits once and previews without activating", async () => {
  const { db, rows, audit } = fixture();
  const input = {
    actorLabel: "fixture",
    evidence: "Reviewed synthetic legacy dispositions",
    sourceUrls: ["https://example.test/review"],
    requiredPolicies: [{ key: trackPolicyKey("act"), policy }],
  };
  await assert.rejects(
    activateArtistTrackPolicyMigration(db, input, true),
    /missing or conflicting/,
  );
  assert.equal(audit.length, 0);
  rows.push({ key: trackPolicyKey("act"), payload: policy });
  assert.equal((await activateArtistTrackPolicyMigration(db, input)).applied, false);
  assert.equal(rows.length, 1);
  assert.equal((await activateArtistTrackPolicyMigration(db, input, true)).applied, true);
  assert.equal((await activateArtistTrackPolicyMigration(db, input, true)).applied, false);
  assert.equal(audit.length, 1);
});
