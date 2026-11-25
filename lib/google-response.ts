import { NextResponse } from "next/server";

export const googleAttemptCookie = "festival_radar_google_attempt";
export const googleCallbackPath = "/api/auth/google/callback/";

export function googleRedirect(destination: URL) {
  return NextResponse.redirect(destination, {
    status: 303,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}

export function noGoogleResponse(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
}
