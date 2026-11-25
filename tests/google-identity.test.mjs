import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyGoogleIdentity } from "../lib/google-identity.ts";

test("Google identity requires a current signed token for the exact issuer, audience and nonce", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const wrongKey = (await generateKeyPair("RS256")).privateKey;
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "test" }] });
  const now = Math.floor(Date.now() / 1000);
  const required = { clientId: "synthetic-google-client", nonce: "synthetic-challenge" };
  const payload = {
    iss: "https://accounts.google.com",
    sub: "google-test-user",
    aud: required.clientId,
    iat: now,
    exp: now + 300,
    email: "TEST@example.test",
    email_verified: true,
    nonce: required.nonce,
    azp: required.clientId,
  };
  async function token(changes = {}, key = privateKey) {
    return new SignJWT({ ...payload, ...changes })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(key);
  }
  const expected = { subject: "google-test-user", email: "test@example.test" };
  assert.deepEqual(await verifyGoogleIdentity(await token(), required, keys), expected);
  assert.deepEqual(
    await verifyGoogleIdentity(await token({ iss: "accounts.google.com" }), required, keys),
    expected,
  );
  for (const changes of [
    { iss: "https://other.example.test" },
    { aud: "other-client" },
    { aud: [required.clientId, "other-client"] },
    { azp: "other-client" },
    { exp: now - 60 },
    { iat: now - 3600 },
    { nonce: "another-challenge" },
    { nonce: undefined },
    { email_verified: false },
    { email_verified: "false" },
    { email: undefined },
    { sub: undefined },
  ]) {
    await assert.rejects(
      verifyGoogleIdentity(await token(changes), required, keys),
      undefined,
      JSON.stringify(changes),
    );
  }
  await assert.rejects(verifyGoogleIdentity(await token({}, wrongKey), required, keys));
});
