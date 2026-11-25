import { SyncKind } from "@prisma/client";
import { db } from "@/lib/db";
import { error } from "@/lib/api";

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  const link = await db.shareLink.findUnique({
    where: { slug: (await context.params).slug },
    include: { document: true },
  });
  if (
    !link ||
    link.document.kind === "SEASON_ATTENDANCE" ||
    link.document.kind === SyncKind.TRIP_BUDGETS ||
    (link.expiresAt && link.expiresAt <= new Date())
  )
    return error("Share link not found.", 404);
  return Response.json({
    kind: link.document.kind,
    payload: link.document.payload,
    updatedAt: link.document.updatedAt,
  });
}
