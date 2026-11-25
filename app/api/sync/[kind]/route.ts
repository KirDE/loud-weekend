import { Prisma, SyncKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";
import { tripBudgetsSchema } from "@/lib/trip-budget";
import { collectionsForSelection } from "@/lib/collections";
import { verifiedSeasonAttendance } from "@/lib/catalog/season-attendance";

const kinds: Record<string, SyncKind> = {
  favorites: SyncKind.FAVORITES,
  collections: SyncKind.COLLECTIONS,
  "saved-filters": SyncKind.SAVED_FILTERS,
  plans: SyncKind.FESTIVAL_PLANS,
  "season-attendance": SyncKind.SEASON_ATTENDANCE,
  budgets: SyncKind.TRIP_BUDGETS,
};
const input = z.object({
  payload: z.json().refine((value) => value !== null),
  revision: z.number().int().nonnegative(),
  accountId: z.string().min(1).max(100).optional(),
});
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const user = await requireUser();
  if (!user) return error("Authentication required.", 401);
  const kind = kinds[(await context.params).kind];
  if (!kind) return error("Unknown sync document.", 404);
  const accountId = request.headers.get("X-Sync-Account");
  if (accountId !== null && accountId !== user.id)
    return error("The signed-in account changed.", 409);
  const document = await db.syncDocument.findUnique({
    where: { userId_kind: { userId: user.id, kind } },
  });
  return Response.json({ document }, { headers: privateHeaders });
}

export async function PUT(request: Request, context: { params: Promise<{ kind: string }> }) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const user = await requireUser();
  if (!user) return error("Authentication required.", 401);
  const kind = kinds[(await context.params).kind];
  if (!kind) return error("Unknown sync document.", 404);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Payload and revision are required.");
  if (
    (kind === SyncKind.SEASON_ATTENDANCE || parsed.data.accountId !== undefined) &&
    parsed.data.accountId !== user.id
  ) {
    return error("The signed-in account changed. Load the latest document.", 409);
  }
  const existing = await db.syncDocument.findUnique({
    where: { userId_kind: { userId: user.id, kind } },
  });
  if ((existing?.revision ?? 0) !== parsed.data.revision)
    return error("Sync conflict. Fetch the latest document.", 409);
  let payload: Prisma.InputJsonValue;
  if (kind === SyncKind.TRIP_BUDGETS && !tripBudgetsSchema.safeParse(parsed.data.payload).success) {
    return error("Invalid trip budgets. Nothing was overwritten.", 400);
  }
  try {
    payload = (
      kind === SyncKind.COLLECTIONS
        ? collectionsForSelection(existing?.payload, parsed.data.payload)
        : parsed.data.payload
    ) as Prisma.InputJsonValue;
  } catch {
    return error("Unsupported collections document. Nothing was overwritten.", 400);
  }
  if (kind === SyncKind.SEASON_ATTENDANCE) {
    const verified = await verifiedSeasonAttendance(db, payload, existing?.payload);
    if (!verified) return error("Attendance must refer to public festival editions.", 400);
    payload = verified;
  }
  try {
    const document = await db.$transaction(async (tx) => {
      if (!existing) return tx.syncDocument.create({ data: { userId: user.id, kind, payload } });
      const updated = await tx.syncDocument.updateMany({
        where: { id: existing.id, revision: parsed.data.revision },
        data: { payload, revision: { increment: 1 } },
      });
      if (!updated.count) return null;
      return tx.syncDocument.findUniqueOrThrow({ where: { id: existing.id } });
    });
    if (!document) return error("Sync conflict. Fetch the latest document.", 409);
    return Response.json({ document }, { status: existing ? 200 : 201, headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002")
      return error("Sync conflict. Fetch the latest document.", 409);
    throw cause;
  }
}
