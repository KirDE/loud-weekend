import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  exchangeGoogleCode,
  googleAuthorizationUrl,
  googleOAuthConfig,
  newGoogleOAuthChallenge,
} from "../lib/google-authorization.ts";

const env = {
  GOOGLE_OIDC_ENABLED: "true",
  GOOGLE_OIDC_CLIENT_ID: "fixture-client",
  GOOGLE_OIDC_CLIENT_SECRET: "fixture-secret",
  AUTH_SECRET: "synthetic-test-auth-secret-only-2026",
  APP_URL: "https://festival.example.test/",
  NODE_ENV: "production",
};

test("Google configuration fails closed without explicit enablement, credentials or safe canonical origin", () => {
  for (const invalid of [
    { GOOGLE_OIDC_ENABLED: "false" },
    { GOOGLE_OIDC_CLIENT_ID: "" },
    { GOOGLE_OIDC_CLIENT_SECRET: "" },
    { APP_URL: undefined },
    { APP_URL: "http://festival.example.test/" },
    { APP_URL: "http://localhost:3000/" },
    { APP_URL: "https://u:p@festival.example.test" },
    { APP_URL: "https://festival.example.test/other" },
    { APP_URL: "https://festival.example.test/?next=other" },
    { APP_URL: "https://festival.example.test/#other" },
  ])
    assert.equal(googleOAuthConfig({ ...env, ...invalid }), null);
  assert.equal(
    googleOAuthConfig(env)?.callback,
    "https://festival.example.test/api/auth/google/callback/",
  );
  assert.equal(
    googleOAuthConfig({ ...env, NODE_ENV: "test", APP_URL: "http://127.0.0.1:3000/" })?.callback,
    "http://127.0.0.1:3000/api/auth/google/callback/",
  );
});

test("authorization uses identity scopes and independent state, nonce and S256 verifier", () => {
  const challenge = newGoogleOAuthChallenge();
  assert.equal(new Set(Object.values(challenge)).size, 3);
  assert.ok(Object.values(challenge).every((value) => /^[\w-]{43}$/.test(value)));
  assert.notEqual(newGoogleOAuthChallenge().state, challenge.state);
  const url = googleAuthorizationUrl(googleOAuthConfig(env), challenge);
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const params = Object.fromEntries(url.searchParams);
  assert.deepEqual(params, {
    client_id: "fixture-client",
    response_type: "code",
    redirect_uri: "https://festival.example.test/api/auth/google/callback/",
    scope: "openid email",
    prompt: "select_account",
    state: challenge.state,
    nonce: challenge.nonce,
    code_challenge: createHash("sha256").update(challenge.verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  assert.ok(
    !url.href.includes(challenge.verifier) && !url.href.includes(env.GOOGLE_OIDC_CLIENT_SECRET),
  );
});

test("code exchange uses the fixed provider and exposes only the ID token", async () => {
  const config = googleOAuthConfig(env);
  const { verifier } = newGoogleOAuthChallenge();
  const id = await exchangeGoogleCode(config, "fixture-code", verifier, async (url, options) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.body.get("code_verifier"), verifier);
    assert.equal(options.body.get("client_secret"), env.GOOGLE_OIDC_CLIENT_SECRET);
    assert.equal(options.body.get("redirect_uri"), config.callback);
    return Response.json({ id_token: "fixture-id-token", access_token: "unneeded-fixture" });
  });
  assert.equal(id, "fixture-id-token");
  for (const output of [
    Response.json({ id_token: "fixture" }, { status: 201 }),
    new Response("not JSON", { status: 200 }),
    Response.json({ access_token: "unneeded-fixture" }),
    Response.json({ id_token: "x".repeat(16_385) }),
    Response.json({ noise: "x".repeat(32_769), id_token: "fixture" }),
  ])
    await assert.rejects(exchangeGoogleCode(config, "fixture-code", verifier, async () => output));
});
