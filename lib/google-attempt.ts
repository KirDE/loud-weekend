import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "./secrets";
import { newGoogleOAuthChallenge } from "./google-authorization";

export const googleAttemptLifetime = 5 * 60 * 1000;
const opaqueToken = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function beginGoogleAttempt(db: PrismaClient, sessionId: string | null) {
  const challenge = newGoogleOAuthChallenge();
  const browserToken = randomBytes(32).toString("base64url");
  await db.$executeRaw`
    DELETE FROM "GoogleOAuthAttempt"
    WHERE "stateHash" IN (
      SELECT "stateHash" FROM "GoogleOAuthAttempt"
      WHERE "expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED
    )
  `;
  await db.googleOAuthAttempt.create({
    data: {
      stateHash: hash(challenge.state),
      browserHash: hash(browserToken),
      nonce: challenge.nonce,
      encryptedVerifier: encrypt(challenge.verifier),
      sessionId,
      expiresAt: new Date(Date.now() + googleAttemptLifetime),
    },
  });
  return { challenge, browserToken };
}

export async function consumeGoogleAttempt(
  db: PrismaClient,
  state: string,
  browserToken: string,
  sessionId: string | null,
) {
  if (!opaqueToken.test(state) || !opaqueToken.test(browserToken)) return null;
  // DELETE RETURNING binds and consumes the challenge as one operation. The
  // link flow records the exact session, not just a user ID or email.
  const [attempt] = await db.$queryRaw<{ nonce: string; encryptedVerifier: string }[]>`
    DELETE FROM "GoogleOAuthAttempt"
    WHERE "stateHash" = ${hash(state)} AND "browserHash" = ${hash(browserToken)}
      AND "sessionId" IS NOT DISTINCT FROM ${sessionId}::text
          AND "expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      AND ("sessionId" IS NULL OR EXISTS (
        SELECT 1 FROM "Session" WHERE "id" = "GoogleOAuthAttempt"."sessionId"
          AND "expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ))
    RETURNING "nonce", "encryptedVerifier"
  `;
  if (!attempt) return null;
  try {
    const verifier = decrypt(attempt.encryptedVerifier);
    return opaqueToken.test(verifier) ? { nonce: attempt.nonce, verifier } : null;
  } catch {
    return null;
  }
}
