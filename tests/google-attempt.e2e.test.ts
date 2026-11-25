import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import { beginGoogleAttempt, consumeGoogleAttempt } from "../lib/google-attempt";
import { requireLocalDisposableDatabase } from "./support/disposable-db";

test("Google callback attempts are single-use, browser-bound, and tied to the original live link session", async () => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const email = `google-attempt-${randomUUID()}@example.test`;
  try {
    const user = await db.user.create({ data: { email }, select: { id: true } });
    const session = await db.session.create({
      data: {
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const link = await beginGoogleAttempt(db, session.id);
    const login = await beginGoogleAttempt(db, null);
    const stored = await db.googleOAuthAttempt.findFirstOrThrow({
      where: { sessionId: session.id },
    });
    assert.notEqual(stored.stateHash, link.challenge.state);
    assert.notEqual(stored.browserHash, link.browserToken);
    assert.notEqual(stored.encryptedVerifier, link.challenge.verifier);

    assert.equal(
      await consumeGoogleAttempt(db, link.challenge.state, login.browserToken, session.id),
      null,
    );
    assert.equal(
      await consumeGoogleAttempt(db, link.challenge.state, link.browserToken, null),
      null,
    );
    assert.equal(
      await consumeGoogleAttempt(db, login.challenge.state, login.browserToken, session.id),
      null,
    );
    const matched = () =>
      consumeGoogleAttempt(db, link.challenge.state, link.browserToken, session.id);
    const claims = (await Promise.all([matched(), matched()])).filter((value) => value !== null);
    assert.deepEqual(claims, [{ nonce: link.challenge.nonce, verifier: link.challenge.verifier }]);

    const expired = await beginGoogleAttempt(db, session.id);
    await db.googleOAuthAttempt.updateMany({
      where: { sessionId: session.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(
      await consumeGoogleAttempt(db, expired.challenge.state, expired.browserToken, session.id),
      null,
    );

    assert.equal(await db.googleOAuthAttempt.count({ where: { sessionId: session.id } }), 1);
    const signedOut = await beginGoogleAttempt(db, session.id);
    assert.equal(await db.googleOAuthAttempt.count({ where: { sessionId: session.id } }), 1);
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
    assert.equal(
      await consumeGoogleAttempt(db, signedOut.challenge.state, signedOut.browserToken, session.id),
      null,
    );
    await db.session.delete({ where: { id: session.id } });
    assert.equal(
      await consumeGoogleAttempt(db, signedOut.challenge.state, signedOut.browserToken, session.id),
      null,
    );
    assert.equal(
      await consumeGoogleAttempt(db, signedOut.challenge.state, signedOut.browserToken, null),
      null,
    );
    assert.deepEqual(
      await consumeGoogleAttempt(db, login.challenge.state, login.browserToken, null),
      {
        nonce: login.challenge.nonce,
        verifier: login.challenge.verifier,
      },
    );
  } finally {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  }
});
