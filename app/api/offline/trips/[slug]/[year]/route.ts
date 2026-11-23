import { readPublishedOfflineTrip } from "@/lib/catalog/offline-trip";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, context: { params: Promise<{ slug: string; year: string }> }) {
  const { slug, year } = await context.params;
  if (!/^[a-z0-9-]{1,160}$/.test(slug) || !/^(?:20\d{2}|2100)$/.test(year)) return new Response(null, { status: 404, headers });
  try {
    const trip = await readPublishedOfflineTrip(slug, Number(year));
    return trip ? Response.json(trip, { headers }) : new Response(null, { status: 404, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
