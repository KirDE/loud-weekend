import { Prisma, type PrismaClient } from "@prisma/client";

type GoogleClaims = { subject: string; email: string };

export class GoogleAccountConflict extends Error {
  constructor() {
    super("Google identity could not be attached to this account.");
  }
}

function translateConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new GoogleAccountConflict();
  }
  throw error;
}

// The Google subject, never its email address, controls access to a linked account.
export async function googleLoginAccount(db: PrismaClient, identity: GoogleClaims) {
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.googleIdentity.findUnique({
        where: { subject: identity.subject },
        select: { userId: true },
      });
      if (existing) return existing.userId;
      const user = await tx.user.create({
        data: { email: identity.email, googleIdentity: { create: { subject: identity.subject } } },
        select: { id: true },
      });
      // A verified provider email is not an application-owned verification event.
      return user.id;
    });
  } catch (error) {
    return translateConflict(error);
  }
}

export async function linkGoogleAccount(
  db: PrismaClient,
  sessionId: string,
  userId: string,
  subject: string,
) {
  try {
    return await db.$transaction(async (tx) => {
      const session = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Session"
        WHERE "id" = ${sessionId} AND "userId" = ${userId}
          AND "expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FOR UPDATE
      `;
      if (!session.length) throw new GoogleAccountConflict();
      const attached = await tx.googleIdentity.findUnique({
        where: { subject },
        select: { userId: true },
      });
      if (attached?.userId === userId) return;
      if (attached) throw new GoogleAccountConflict();
      await tx.googleIdentity.create({ data: { subject, userId } });
    });
  } catch (error) {
    return translateConflict(error);
  }
}
