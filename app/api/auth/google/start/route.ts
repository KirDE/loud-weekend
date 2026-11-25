import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { beginGoogleAttempt, googleAttemptLifetime } from "@/lib/google-attempt";
import { googleAuthorizationUrl, googleOAuthConfig } from "@/lib/google-authorization";
import {
  googleAttemptCookie,
  googleCallbackPath,
  googleRedirect,
  noGoogleResponse,
} from "@/lib/google-response";
import { requestHasTrustedOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  const config = googleOAuthConfig();
  if (!config) return noGoogleResponse(404);
  if (!requestHasTrustedOrigin(request, config.callback)) return noGoogleResponse(403);
  const modes = new URL(request.url).searchParams.getAll("mode");
  if (modes.length !== 1 || (modes[0] !== "login" && modes[0] !== "link"))
    return noGoogleResponse(400);
  try {
    const session = await currentSession();
    if ((modes[0] === "link") !== Boolean(session)) return noGoogleResponse(403);
    const { challenge, browserToken } = await beginGoogleAttempt(db, session?.id ?? null);
    const response = googleRedirect(googleAuthorizationUrl(config, challenge));
    response.cookies.set(googleAttemptCookie, browserToken, {
      httpOnly: true,
      secure: new URL(config.callback).protocol === "https:",
      sameSite: "lax",
      path: googleCallbackPath,
      maxAge: googleAttemptLifetime / 1000,
    });
    return response;
  } catch {
    return noGoogleResponse(503);
  }
}
