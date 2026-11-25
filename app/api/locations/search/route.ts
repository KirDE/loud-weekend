import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeOriginName, searchOrigins } from "@/lib/origin-gazetteer";
import { requestHasTrustedOrigin } from "@/lib/request-origin";

const input = z.strictObject({
  query: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine((value) => normalizeOriginName(value).length >= 2),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
});
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function POST(request: Request) {
  if (!requestHasTrustedOrigin(request))
    return Response.json({ error: "Untrusted origin" }, { status: 403, headers });
  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: "Invalid place search" }, { status: 400, headers });
  const result = await searchOrigins(db, body.data);
  return Response.json(result, { status: result.available ? 200 : 503, headers });
}
