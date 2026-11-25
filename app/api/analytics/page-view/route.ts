import { z } from "zod";
import { db } from "@/lib/db";
import { PRODUCT_EVENT_TYPE } from "@/lib/product-events";
import { createProductEventLimiter, parseProductEvent } from "@/lib/product-event-ingestion";

export const dynamic = "force-dynamic";
const pageView = z
  .object({
    path: z
      .string()
      .regex(/^\/(?!\/)/)
      .max(512)
      .refine((value) => !/[?#]/.test(value)),
    locale: z.enum(["en", "de", "ru"]),
  })
  .strict();
const responseHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

const allowProductEvent = createProductEventLimiter();

function utcDay() {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

async function ingestProductEvent(request: Request) {
  const headers = request.headers;
  if (
    process.env.PRODUCT_EVENTS_ENABLED !== "true" ||
    headers.get("dnt") === "1" ||
    headers.get("sec-gpc") === "1"
  ) {
    return new Response(null, { status: 204, headers: responseHeaders });
  }
  if (headers.get("sec-fetch-site") !== "same-origin")
    return new Response(null, { status: 403, headers: responseHeaders });
  if (!allowProductEvent(Date.now()))
    return new Response(null, { status: 429, headers: responseHeaders });
  const payload = await parseProductEvent(request);
  if (!payload) return new Response(null, { status: 400, headers: responseHeaders });
  const day = utcDay();
  await db.productEventDaily.upsert({
    where: { day_event_locale: { day, ...payload } },
    create: { day, ...payload, count: 1 },
    update: { count: { increment: 1 } },
  });
  return new Response(null, { status: 204, headers: responseHeaders });
}

export async function POST(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === PRODUCT_EVENT_TYPE
  ) {
    return ingestProductEvent(request);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json(
      { error: "Cross-site beacons are not accepted." },
      { status: 403, headers: responseHeaders },
    );
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: responseHeaders },
    );
  const parsed = pageView.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Invalid page view." },
      { status: 400, headers: responseHeaders },
    );
  const day = utcDay();
  await db.analyticsDaily.upsert({
    where: { day_path_locale: { day, path: parsed.data.path, locale: parsed.data.locale } },
    create: { day, ...parsed.data, views: 1 },
    update: { views: { increment: 1 } },
  });
  return new Response(null, { status: 204, headers: responseHeaders });
}

export async function GET(request: Request) {
  const token = process.env.ANALYTICS_OPERATOR_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`)
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: responseHeaders });
  const url = new URL(request.url);
  const days = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("days") ?? "7", 10) || 7, 1),
    90,
  );
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days + 1);
  if (url.searchParams.get("kind") === "product-events") {
    const counts = await db.productEventDaily.findMany({
      where: { day: { gte: since } },
      orderBy: [{ day: "asc" }, { event: "asc" }, { locale: "asc" }],
    });
    return Response.json(
      { since: since.toISOString(), days, counts },
      { headers: responseHeaders },
    );
  }
  const rows = await db.analyticsDaily.findMany({
    where: { day: { gte: since } },
    orderBy: [{ day: "asc" }, { path: "asc" }],
  });
  return Response.json(
    {
      since: since.toISOString(),
      days,
      totalViews: rows.reduce((sum, row) => sum + row.views, 0),
      counts: rows,
    },
    { headers: responseHeaders },
  );
}
