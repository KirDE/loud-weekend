import { currentAdmin } from "@/lib/admin-access";
import { error } from "@/lib/api";
import { db } from "@/lib/db";
import { rejectUntrustedOrigin } from "@/lib/request-origin";
import { newFestivalAction, reviewNewFestival } from "@/lib/submission-new-festival";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const editor = await currentAdmin();
  if (!editor) return error("Forbidden", 403);
  const input = newFestivalAction.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return error("Valid reviewed festival identity and edition evidence is required", 422);
  const result = await reviewNewFestival(db, (await params).reference, input.data, editor.id);
  if (!result) return error("No eligible approved submission or review draft", 409);
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
