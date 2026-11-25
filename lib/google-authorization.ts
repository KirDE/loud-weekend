import { createHash, randomBytes } from "node:crypto";

const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";

export function googleOAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const { GOOGLE_OIDC_CLIENT_ID: clientId, GOOGLE_OIDC_CLIENT_SECRET: clientSecret, APP_URL } = env;
  if (
    env.GOOGLE_OIDC_ENABLED !== "true" ||
    (env.AUTH_SECRET?.length ?? 0) < 32 ||
    !clientId?.trim() ||
    !clientSecret?.trim() ||
    !APP_URL
  )
    return null;
  try {
    const app = new URL(APP_URL);
    const loopback =
      app.hostname === "localhost" || app.hostname === "127.0.0.1" || app.hostname === "[::1]";
    if (
      app.username ||
      app.password ||
      app.search ||
      app.hash ||
      app.pathname !== "/" ||
      (app.protocol !== "https:" &&
        !(env.NODE_ENV !== "production" && app.protocol === "http:" && loopback))
    )
      return null;
    return { clientId, clientSecret, callback: new URL("/api/auth/google/callback/", app).href };
  } catch {
    return null;
  }
}

export function newGoogleOAuthChallenge() {
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
  };
}

export function googleAuthorizationUrl(
  config: NonNullable<ReturnType<typeof googleOAuthConfig>>,
  challenge: ReturnType<typeof newGoogleOAuthChallenge>,
) {
  const url = new URL(authorizeEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.callback,
    scope: "openid email",
    prompt: "select_account",
    state: challenge.state,
    nonce: challenge.nonce,
    code_challenge: createHash("sha256").update(challenge.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url;
}

export async function exchangeGoogleCode(
  config: NonNullable<ReturnType<typeof googleOAuthConfig>>,
  code: string,
  verifier: string,
  request: typeof fetch = fetch,
) {
  if (!code || code.length > 2_048 || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) {
    throw new Error("Invalid Google authorization.");
  }
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: config.callback,
    }),
  });
  if (
    !response.ok ||
    response.status !== 200 ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  ) {
    throw new Error("Invalid Google authorization.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid Google authorization.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32_768) throw new Error("Invalid Google authorization.");
      body += decoder.decode(chunk.value, { stream: true });
    }
    const result = JSON.parse(body + decoder.decode()) as { id_token?: unknown } | null;
    if (
      typeof result?.id_token !== "string" ||
      !result.id_token ||
      result.id_token.length > 16_384
    ) {
      throw new Error("Invalid Google authorization.");
    }
    return result.id_token;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
