import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

// Preloaded only by the disposable integration server. No provider endpoint is
// configurable in the application, and the fixture never contacts Google.
const keys = generateKeyPair("RS256");
const actualFetch = globalThis.fetch;

globalThis.fetch = async function (resource, options) {
  const url = resource instanceof Request ? resource.url : String(resource);
  if (url === "https://www.googleapis.com/oauth2/v3/certs") {
    const jwk = await exportJWK((await keys).publicKey);
    return Response.json({ keys: [{ ...jwk, kid: "integration-google", alg: "RS256" }] });
  }

  if (url === "https://oauth2.googleapis.com/token") {
    const body = options.body;
    const { email, subject, nonce, challenge } = JSON.parse(body.get("code"));
    const boundVerifier = createHash("sha256")
      .update(body.get("code_verifier"))
      .digest("base64url");
    if (
      options.method !== "POST" ||
      body.get("grant_type") !== "authorization_code" ||
      body.get("client_id") !== "integration-google-client" ||
      body.get("client_secret") !== "integration-google-secret" ||
      body.get("redirect_uri") !==
        new URL("/api/auth/google/callback/", process.env.APP_URL).href ||
      challenge !== boundVerifier
    ) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    const token = await new SignJWT({ email, email_verified: true, nonce })
      .setProtectedHeader({ alg: "RS256", kid: "integration-google" })
      .setIssuer("https://accounts.google.com")
      .setAudience("integration-google-client")
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign((await keys).privateKey);
    return Response.json({ id_token: token });
  }

  return actualFetch(resource, options);
};
