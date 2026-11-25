import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import {
  acceptGroupTripInvite,
  addGroupTripComment,
  createGroupTrip,
  GroupTripError,
  inviteToGroupTrip,
  readGroupTrip,
  removeGroupTripComment,
  revokeGroupTripInvite,
  setGroupTripVote,
} from "../lib/group-trips";
import { requireLocalDisposableDatabase } from "./support/disposable-db";

test("group trip grants scope reads and votes, serialize claims and revoke access atomically", async () => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const key = randomUUID();
  const emails = ["owner", "voter", "viewer", "stranger"].map(
    (person) => `${person}-${key}@example.test`,
  );
  const slug = `group-trip-fixture-${key}`;
  const denied = (code: GroupTripError["code"]) => (error: unknown) =>
    error instanceof GroupTripError && error.code === code;
  try {
    const users = await Promise.all(
      emails.map((email) => db.user.create({ data: { email }, select: { id: true } })),
    );
    const [owner, voter, viewer, stranger] = users.map(({ id }) => id);
    const festival = await db.festival.create({
      data: {
        slug,
        name: "Fixture",
        countryCode: "DE",
        country: "Germany",
        officialUrl: "https://example.test/",
        catalogOrder: 1,
        genres: [],
        editions: {
          create: [
            {
              year: 2027,
              status: "TBA",
              completeness: "TBA",
              recordState: "CURRENT",
              ticketStatus: "UNKNOWN",
              sourceUpdatedAt: new Date(),
            },
            {
              year: 2028,
              status: "TBA",
              completeness: "TBA",
              recordState: "TRACKING",
              ticketStatus: "UNKNOWN",
              sourceUpdatedAt: new Date(),
            },
          ],
        },
      },
      select: { editions: { select: { id: true, year: true } } },
    });
    const edition = festival.editions.find(({ year }) => year === 2027)!.id;
    const unverified = festival.editions.find(({ year }) => year === 2028)!.id;
    await assert.rejects(
      createGroupTrip(db, owner, "Fixture trip", [unverified]),
      denied("invalid"),
    );
    const { id } = await createGroupTrip(db, owner, "Fixture trip", [edition]);
    await assert.rejects(readGroupTrip(db, stranger, id), denied("missing"));
    await assert.rejects(inviteToGroupTrip(db, stranger, id, "VOTER"), denied("missing"));

    const voteGrant = await inviteToGroupTrip(db, owner, id, "VOTER");
    const claim = await Promise.allSettled([
      acceptGroupTripInvite(db, voter, voteGrant.secret),
      acceptGroupTripInvite(db, voter, voteGrant.secret),
    ]);
    assert.equal(claim.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(await db.groupTripInvite.count({ where: { tokenHash: voteGrant.secret } }), 0);
    const viewGrant = await inviteToGroupTrip(db, owner, id, "VIEWER");
    await acceptGroupTripInvite(db, viewer, viewGrant.secret);
    await assert.rejects(setGroupTripVote(db, viewer, id, edition, "NOT_GOING"), denied("missing"));
    await assert.rejects(setGroupTripVote(db, voter, id, unverified, "GOING"), denied("missing"));

    await Promise.all([
      setGroupTripVote(db, voter, id, edition, "GOING"),
      setGroupTripVote(db, owner, id, edition, "MAYBE"),
    ]);
    const visible = await readGroupTrip(db, viewer, id);
    assert.deepEqual(visible, {
      id,
      title: "Fixture trip",
      role: "VIEWER",
      options: [
        {
          editionId: edition,
          slug,
          name: "Fixture",
          year: 2027,
          ownVote: null,
          comments: [],
          tally: { GOING: 1, MAYBE: 1 },
        },
      ],
    });
    await assert.rejects(
      addGroupTripComment(db, viewer, id, edition, "Read-only"),
      denied("missing"),
    );
    await assert.rejects(
      addGroupTripComment(db, voter, id, unverified, "Wrong edition"),
      denied("missing"),
    );
    await addGroupTripComment(db, voter, id, edition, "Meet at the entrance");
    const [comment] = (await readGroupTrip(db, viewer, id)).options[0].comments;
    assert.deepEqual(Object.keys(comment).sort(), ["body", "canRemove", "createdAt", "id", "own"]);
    assert.equal(comment.body, "Meet at the entrance");
    assert.equal(comment.canRemove, false);
    await assert.rejects(removeGroupTripComment(db, viewer, id, comment.id), denied("missing"));
    await removeGroupTripComment(db, owner, id, comment.id);
    await addGroupTripComment(db, voter, id, edition, "Remove on revocation");

    await assert.rejects(revokeGroupTripInvite(db, voter, id, voteGrant.id), denied("missing"));
    await revokeGroupTripInvite(db, owner, id, voteGrant.id);
    await assert.rejects(readGroupTrip(db, voter, id), denied("missing"));
    await assert.rejects(setGroupTripVote(db, voter, id, edition, "GOING"), denied("missing"));
    const afterRevoke = (await readGroupTrip(db, viewer, id)).options[0];
    assert.deepEqual(afterRevoke.tally, { MAYBE: 1 });
    assert.deepEqual(afterRevoke.comments, []);

    const expired = await inviteToGroupTrip(db, owner, id, "VIEWER");
    await db.groupTripInvite.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    await assert.rejects(acceptGroupTripInvite(db, stranger, expired.secret), denied("missing"));
    await revokeGroupTripInvite(db, owner, id, expired.id);
    assert.equal(await db.groupTripAudit.count({ where: { tripId: id, action: "REVOKED" } }), 2);
  } finally {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.festival.deleteMany({ where: { slug } });
    await db.$disconnect();
  }
});
