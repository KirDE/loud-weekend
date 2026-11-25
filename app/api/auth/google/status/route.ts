import { googleOAuthConfig } from "@/lib/google-authorization";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { available: Boolean(googleOAuthConfig()) },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
