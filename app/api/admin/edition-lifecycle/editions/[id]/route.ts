import { currentAdmin } from "@/lib/admin-access";
import { db } from "@/lib/db";
import { readPendingEditionLifecycle } from "@/lib/ingestion/edition-lifecycle-proposal-store";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/** Authenticated reviewer readback, never a public lifecycle endpoint. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await currentAdmin()) return reply({ error: "Forbidden" }, 403);
  try {
    const snapshot = await readPendingEditionLifecycle(db, (await params).id);
    return snapshot ? reply(snapshot) : reply({ error: "No lifecycle proposal" }, 404);
  } catch {
    return reply({ error: "Lifecycle proposal could not be validated" }, 409);
  }
}
