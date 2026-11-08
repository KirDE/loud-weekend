import { z } from "zod";
import { error } from "@/lib/api";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ festivals: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional() });

export async function POST(request: Request) {
  if (!process.env.INTERNAL_API_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.INTERNAL_API_SECRET}`) return error("Unauthorized.", 401);
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid playlist refresh request.");

  const festivals = [...new Set(parsed.data.festivals ?? [])].sort();
  const jobs = await db.catalogPlaylistRefresh.findMany({ where: { status: { in: ["PENDING", "RUNNING", "FAILED"] }, ...(festivals.length ? { festivalSlug: { in: festivals } } : {}) }, select: { id: true, status: true, festivalSlug: true }, take: 100 });
  return Response.json({ status: "QUEUED", jobs }, { status: 202 });
}
