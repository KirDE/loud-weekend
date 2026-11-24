import { currentAdmin } from "@/lib/admin-access";
import { error } from "@/lib/api";
import { db } from "@/lib/db";
import { rejectUntrustedOrigin } from "@/lib/request-origin";
import { linkSubmissionEdition } from "@/lib/submission-edition-link";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const editor = await currentAdmin();
  if (!editor) return error("Forbidden", 403);
  const body = await request.json().catch(() => null);
  if (typeof body?.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,179}$/.test(body.slug))
    return error("Choose an existing edition", 422);
  const link = await linkSubmissionEdition(db, (await params).reference, body.slug, editor.id);
  if (!link) return error("No matching approved submission and edition", 409);
  return Response.json(link, { headers: { "Cache-Control": "no-store" } });
}
