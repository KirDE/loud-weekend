import { cookies } from "next/headers";
import { createSession, currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  GoogleAccountConflict,
  googleLoginAccount,
  linkGoogleAccount,
} from "@/lib/google-accounts";
import { consumeGoogleAttempt } from "@/lib/google-attempt";
import { exchangeGoogleCode, googleOAuthConfig } from "@/lib/google-authorization";
import { verifyGoogleIdentity } from "@/lib/google-identity";
import {
  googleAttemptCookie,
  googleCallbackPath,
  googleRedirect,
  noGoogleResponse,
} from "@/lib/google-response";

export async function GET(request: Request) {
  const config = googleOAuthConfig();
  if (!config) return noGoogleResponse(404);
  const result = new URL("/planner/", config.callback);
  const finish = (status: "connected" | "conflict" | "failed") => {
    result.searchParams.set("google", status);
    const response = googleRedirect(result);
    response.cookies.set(googleAttemptCookie, "", {
      httpOnly: true,
      secure: new URL(config.callback).protocol === "https:",
      sameSite: "lax",
      path: googleCallbackPath,
      maxAge: 0,
    });
    return response;
  };
  const params = new URL(request.url).searchParams;
  const states = params.getAll("state");
  const codes = params.getAll("code");
  const browserToken = (await cookies()).get(googleAttemptCookie)?.value;
  if (!browserToken || states.length !== 1) return finish("failed");

  try {
    const session = await currentSession();
    const attempt = await consumeGoogleAttempt(db, states[0], browserToken, session?.id ?? null);
    if (!attempt || codes.length !== 1 || params.has("error")) return finish("failed");
    const token = await exchangeGoogleCode(config, codes[0], attempt.verifier);
    const identity = await verifyGoogleIdentity(token, {
      clientId: config.clientId,
      nonce: attempt.nonce,
    });
    if (session) await linkGoogleAccount(db, session.id, session.userId, identity.subject);
    else await createSession(await googleLoginAccount(db, identity));
    return finish("connected");
  } catch (error) {
    return finish(error instanceof GoogleAccountConflict ? "conflict" : "failed");
  }
}
