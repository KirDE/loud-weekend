import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import {
  googleLoginAccount,
  GoogleAccountConflict,
  linkGoogleAccount,
} from "../lib/google-accounts";
import { requireLocalDisposableDatabase } from "./support/disposable-db";

test("Google sign-in never attaches by email; explicit linking is bound to the signed-in account", async () => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const key = randomUUID();
  const oldEmail = `existing-${key}@example.test`;
  const googleEmail = `new-${key}@example.test`;
  const existingSubject = `existing-subject-${key}`;
  const newSubject = `new-subject-${key}`;
  try {
    const existing = await db.user.create({
      data: { email: oldEmail, passwordHash: "synthetic-hash" },
      select: { id: true },
    });
    await assert.rejects(
      googleLoginAccount(db, { subject: existingSubject, email: oldEmail }),
      GoogleAccountConflict,
    );
    assert.equal(await db.googleIdentity.count({ where: { subject: existingSubject } }), 0);
    const created = await googleLoginAccount(db, { subject: newSubject, email: googleEmail });
    assert.notEqual(created, existing.id);
    assert.equal(await googleLoginAccount(db, { subject: newSubject, email: oldEmail }), created);
    const google = await db.user.findUniqueOrThrow({ where: { id: created } });
    assert.equal(google.email, googleEmail);
    assert.equal(google.emailVerifiedAt, null);

    const session = await db.session.create({
      data: {
        userId: existing.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await assert.rejects(
      linkGoogleAccount(db, session.id, created, existingSubject),
      GoogleAccountConflict,
    );
    await assert.rejects(
      linkGoogleAccount(db, session.id, existing.id, newSubject),
      GoogleAccountConflict,
    );
    await linkGoogleAccount(db, session.id, existing.id, existingSubject);
    await linkGoogleAccount(db, session.id, existing.id, existingSubject);
    await assert.rejects(
      linkGoogleAccount(db, session.id, existing.id, `second-${key}`),
      GoogleAccountConflict,
    );
    assert.equal(
      await googleLoginAccount(db, { subject: existingSubject, email: googleEmail }),
      existing.id,
    );
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: existing.id } })).passwordHash,
      "synthetic-hash",
    );
  } finally {
    await db.user.deleteMany({ where: { email: { in: [oldEmail, googleEmail] } } });
    await db.$disconnect();
  }
});
