import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { rejectUntrustedOrigin } from "@/lib/request-origin";
import { maxPerformanceSelections, performanceSelectionId } from "@/lib/timetable-plan";

type Context = { params: Promise<{ slug: string; year: string }> };
const selectedFields = { performanceIds: true, revision: true } as const;
const input = z.object({
  accountId: z.string().min(1).max(100),
  revision: z.number().int().min(0).max(2_147_483_646),
  performanceIds: z.array(z.string().regex(performanceSelectionId)).max(maxPerformanceSelections)
    .refine(ids => new Set(ids).size === ids.length),
}).strict();

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function findEdition({ params }: Context) {
  const { slug, year } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,179}$/.test(slug) || !/^\d{4}$/.test(year)) return null;
  return db.festivalEdition.findFirst({
    where: { festival: { slug }, year: Number(year) }, select: { id: true },
  });
}

export async function GET(_: Request, context: Context) {
  const user = await requireUser();
  if (!user) return json({ error: "Authentication required." }, 401);
  const edition = await findEdition(context);
  if (!edition) return json({ error: "Edition not found." }, 404);
  const copy = await db.runningOrder.findUnique({
    where: { userId_editionId: { userId: user.id, editionId: edition.id } }, select: selectedFields,
  });
  return json({ account: { id: user.id, email: user.email }, copy: copy ?? { performanceIds: [], revision: 0 } });
}

export async function PUT(request: Request, context: Context) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return json({ error: "Untrusted request origin." }, 403);
  const user = await requireUser();
  if (!user) return json({ error: "Authentication required." }, 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid running order." }, 400);
  const { accountId, revision, performanceIds } = parsed.data;
  const conflict = () => json({ error: "The account or saved copy changed. Check the latest copy." }, 409);
  if (accountId !== user.id) return conflict();
  const edition = await findEdition(context);
  if (!edition) return json({ error: "Edition not found." }, 404);
  const key = { userId: user.id, editionId: edition.id };
  try {
    const result = await db.$transaction(async tx => {
      const verifiedCount = performanceIds.length ? await tx.timetablePerformance.count({
        where: { editionId: edition.id, sourcePerformanceId: { in: performanceIds }, observedAt: { not: null }, sourceUrl: { not: null } },
      }) : 0;
      if (verifiedCount !== performanceIds.length) return { invalid: true } as const;
      if (revision === 0) {
        return { copy: await tx.runningOrder.create({ data: { ...key, performanceIds }, select: selectedFields }) };
      }
      const updated = await tx.runningOrder.updateMany({
        where: { ...key, revision }, data: { performanceIds, revision: { increment: 1 } },
      });
      if (!updated.count) return null;
      return { copy: { performanceIds, revision: revision + 1 } };
    });
    if (!result) return conflict();
    if ("invalid" in result) return json({ error: "Unknown performance for this edition." }, 400);
    return json(result);
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return conflict();
    throw cause;
  }
}
