import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

const maxOwnedTrips = 15;
const maxOptions = 12;
const maxInvites = 30;
const inviteLifetime = 7 * 24 * 60 * 60 * 1000;
type InviteRole = "VIEWER" | "VOTER";
type Vote = "GOING" | "MAYBE" | "NOT_GOING";
type Tx = Prisma.TransactionClient;

export class GroupTripError extends Error {
  constructor(readonly code: "missing" | "invalid" | "limit") {
    super(`Group trip: ${code}`);
  }
}

const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");

async function lockTrip(tx: Tx, tripId: string) {
  const [trip] = await tx.$queryRaw<{ id: string; ownerId: string; title: string }[]>`
    SELECT "id", "ownerId", "title" FROM "GroupTrip" WHERE "id" = ${tripId} FOR UPDATE
  `;
  if (!trip) throw new GroupTripError("missing");
  return trip;
}

async function tripRole(tx: Tx, trip: { id: string; ownerId: string }, userId: string) {
  if (trip.ownerId === userId) return "OWNER";
  const grant = await tx.groupTripInvite.findFirst({
    where: { tripId: trip.id, claimedById: userId, revokedAt: null },
    select: { role: true },
  });
  return grant?.role;
}

export function createGroupTrip(
  db: PrismaClient,
  ownerId: string,
  title: string,
  editionIds: string[],
) {
  const name = title.trim();
  const ids = [...new Set(editionIds)].sort();
  if (!name || name.length > 80 || !ids.length || ids.length > maxOptions)
    throw new GroupTripError("invalid");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE`;
    if ((await tx.groupTrip.count({ where: { ownerId } })) >= maxOwnedTrips)
      throw new GroupTripError("limit");
    const editions = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "FestivalEdition"
      WHERE "id" IN (${Prisma.join(ids)}) AND "recordState" = 'CURRENT'
      ORDER BY "id" FOR SHARE
    `);
    if (editions.length !== ids.length) throw new GroupTripError("invalid");
    return tx.groupTrip.create({
      data: {
        ownerId,
        title: name,
        options: { create: editions.map(({ id }) => ({ editionId: id })) },
        audit: { create: { action: "CREATED" } },
      },
      select: { id: true },
    });
  });
}

export function inviteToGroupTrip(
  db: PrismaClient,
  ownerId: string,
  tripId: string,
  role: InviteRole,
) {
  return db.$transaction(async (tx) => {
    const trip = await lockTrip(tx, tripId);
    if (trip.ownerId !== ownerId) throw new GroupTripError("missing");
    const now = new Date();
    const active = await tx.groupTripInvite.count({
      where: {
        tripId,
        revokedAt: null,
        OR: [{ claimedById: { not: null } }, { claimedAt: null, expiresAt: { gt: now } }],
      },
    });
    if (active >= maxInvites) throw new GroupTripError("limit");
    const secret = randomBytes(32).toString("base64url");
    const invite = await tx.groupTripInvite.create({
      data: { tripId, role, tokenHash: digest(secret), expiresAt: new Date(+now + inviteLifetime) },
      select: { id: true, expiresAt: true },
    });
    await tx.groupTripAudit.create({ data: { tripId, action: "INVITED" } });
    return { ...invite, secret };
  });
}

export function acceptGroupTripInvite(db: PrismaClient, userId: string, secret: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new GroupTripError("missing");
  return db.$transaction(async (tx) => {
    const invite = await tx.groupTripInvite.findUnique({
      where: { tokenHash: digest(secret) },
      select: { id: true, tripId: true },
    });
    if (!invite) throw new GroupTripError("missing");
    const trip = await lockTrip(tx, invite.tripId);
    if (await tripRole(tx, trip, userId)) throw new GroupTripError("invalid");
    const now = new Date();
    const accepted = await tx.groupTripInvite.updateMany({
      where: { id: invite.id, revokedAt: null, claimedAt: null, expiresAt: { gt: now } },
      data: { claimedById: userId, claimedAt: now },
    });
    if (accepted.count !== 1) throw new GroupTripError("missing");
    await tx.groupTripAudit.create({ data: { tripId: trip.id, action: "JOINED" } });
    return { id: trip.id };
  });
}

export function revokeGroupTripInvite(
  db: PrismaClient,
  ownerId: string,
  tripId: string,
  inviteId: string,
) {
  return db.$transaction(async (tx) => {
    const trip = await lockTrip(tx, tripId);
    if (trip.ownerId !== ownerId) throw new GroupTripError("missing");
    const invite = await tx.groupTripInvite.findFirst({
      where: { id: inviteId, tripId },
      select: { claimedById: true, revokedAt: true },
    });
    if (!invite) throw new GroupTripError("missing");
    if (invite.revokedAt) return;
    await tx.groupTripInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date(), claimedById: null },
    });
    if (invite.claimedById) {
      await tx.groupTripVote.deleteMany({ where: { tripId, voterId: invite.claimedById } });
    }
    await tx.groupTripAudit.create({ data: { tripId, action: "REVOKED" } });
  });
}

export function setGroupTripVote(
  db: PrismaClient,
  userId: string,
  tripId: string,
  editionId: string,
  choice: Vote | null,
) {
  return db.$transaction(async (tx) => {
    const trip = await lockTrip(tx, tripId);
    const role = await tripRole(tx, trip, userId);
    if (role !== "OWNER" && role !== "VOTER") throw new GroupTripError("missing");
    if (
      !(await tx.groupTripOption.findUnique({ where: { tripId_editionId: { tripId, editionId } } }))
    ) {
      throw new GroupTripError("missing");
    }
    const ballot = { tripId, editionId, voterId: userId };
    if (choice === null) {
      await tx.groupTripVote.deleteMany({ where: ballot });
      return;
    }
    await tx.groupTripVote.upsert({
      where: { tripId_editionId_voterId: ballot },
      create: { ...ballot, choice },
      update: { choice },
    });
  });
}

export function readGroupTrip(db: PrismaClient, userId: string, tripId: string) {
  return db.$transaction(async (tx) => {
    const trip = await lockTrip(tx, tripId);
    const role = await tripRole(tx, trip, userId);
    if (!role) throw new GroupTripError("missing");
    const options = await tx.groupTripOption.findMany({
      where: { tripId },
      orderBy: [
        { edition: { year: "asc" } },
        { edition: { festival: { name: "asc" } } },
        { editionId: "asc" },
      ],
      select: {
        editionId: true,
        edition: { select: { year: true, festival: { select: { slug: true, name: true } } } },
        votes: { where: { voterId: userId }, select: { choice: true } },
      },
    });
    const counts = await tx.groupTripVote.groupBy({
      by: ["editionId", "choice"],
      where: { tripId },
      _count: { _all: true },
    });
    const ownerDetails =
      role === "OWNER"
        ? {
            invites: await tx.groupTripInvite.findMany({
              where: {
                tripId,
                revokedAt: null,
                OR: [
                  { claimedById: { not: null } },
                  { claimedAt: null, expiresAt: { gt: new Date() } },
                ],
              },
              orderBy: [{ expiresAt: "desc" }, { id: "asc" }],
              select: { id: true, role: true, expiresAt: true, claimedAt: true },
            }),
            audit: await tx.groupTripAudit.findMany({
              where: { tripId },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 20,
              select: { action: true, createdAt: true },
            }),
          }
        : undefined;
    return {
      id: trip.id,
      title: trip.title,
      role,
      ...ownerDetails,
      options: options.map(({ editionId, edition, votes }) => ({
        editionId,
        ...edition.festival,
        year: edition.year,
        ownVote: votes[0]?.choice ?? null,
        tally: Object.fromEntries(
          counts
            .filter((count) => count.editionId === editionId)
            .map(({ choice, _count }) => [choice, _count._all]),
        ),
      })),
    };
  });
}

export async function listGroupTrips(db: PrismaClient, userId: string) {
  const [trips, editions] = await Promise.all([
    db.groupTrip.findMany({
      where: {
        OR: [{ ownerId: userId }, { invites: { some: { claimedById: userId, revokedAt: null } } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true, title: true },
    }),
    db.festivalEdition.findMany({
      where: { recordState: "CURRENT" },
      orderBy: [{ year: "asc" }, { festival: { name: "asc" } }, { id: "asc" }],
      select: { id: true, year: true, festival: { select: { name: true } } },
    }),
  ]);
  return {
    trips,
    editions: editions.map(({ id, year, festival }) => ({ id, year, name: festival.name })),
  };
}

export function leaveGroupTrip(db: PrismaClient, userId: string, tripId: string) {
  return db.$transaction(async (tx) => {
    const trip = await lockTrip(tx, tripId);
    if (trip.ownerId === userId) throw new GroupTripError("invalid");
    const revoked = await tx.groupTripInvite.updateMany({
      where: { tripId, claimedById: userId, revokedAt: null },
      data: { revokedAt: new Date(), claimedById: null },
    });
    if (!revoked.count) throw new GroupTripError("missing");
    await tx.groupTripVote.deleteMany({ where: { tripId, voterId: userId } });
    await tx.groupTripAudit.create({ data: { tripId, action: "REVOKED" } });
  });
}

export function deleteGroupTrip(db: PrismaClient, ownerId: string, tripId: string) {
  return db.$transaction(async (tx) => {
    const trip = await lockTrip(tx, tripId);
    if (trip.ownerId !== ownerId) throw new GroupTripError("missing");
    await tx.groupTrip.delete({ where: { id: tripId } });
  });
}
