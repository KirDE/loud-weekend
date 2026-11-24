import { currentAdmin } from "@/lib/admin-access";
import { error } from "@/lib/api";
import { decideCorrection } from "@/lib/correction-reports";
import { db } from "@/lib/db";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const actor = await currentAdmin();
  if (!actor) return error("Forbidden", 403);
  const body = await request.json().catch(() => null);
  if (body?.status !== "ACCEPTED" && body?.status !== "DISMISSED")
    return error("Invalid decision", 422);
  const changed = await decideCorrection(db, (await params).id, actor.id, body.status);
  if (!changed) return error("Report is not pending", 409);
  return Response.json({ status: body.status });
}
