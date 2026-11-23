import { currentAdmin } from "@/lib/admin-access";
import { db } from "@/lib/db";
import { readPendingHellfestOffers } from "@/lib/ingestion/ticket-offer-proposal-store";

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/** Authenticated reviewer readback, never a public inventory endpoint. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentAdmin())) return reply({ error: "Forbidden" }, 403);
  try {
    const snapshot = await readPendingHellfestOffers(db, (await params).id);
    return snapshot ? reply(snapshot) : reply({ error: "No tier proposal" }, 404);
  } catch {
    return reply({ error: "Tier proposal could not be validated" }, 409);
  }
}
