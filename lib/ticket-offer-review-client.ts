import { ticketOfferReviewSchema, type TicketOfferReview } from "./domain/ticket-offer-review";

/** Same-origin reviewer API only. Never send an actor, offer, or source override. */
export async function loadTicketOfferReview(editionId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<TicketOfferReview | null> {
  const response = await fetcher(`/api/admin/ticket-offers/editions/${encodeURIComponent(editionId)}`, { cache: "no-store", signal, headers: { accept: "application/json" } });
  const body = await response.json();
  if (response.status === 404 && body?.error === "No tier proposal") return null;
  if (!response.ok) throw new Error("Tier review unavailable");
  return ticketOfferReviewSchema.parse(body);
}

export async function submitTicketOfferReview(snapshot: TicketOfferReview, decision: "approve" | "reject", signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`/api/admin/ticket-offers/snapshots/${encodeURIComponent(snapshot.id)}`, {
    method: "POST", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, expectedContentHash: snapshot.contentHash }),
  });
  const body = await response.json();
  if (!response.ok || body?.snapshotId !== snapshot.id || body?.decision !== decision) throw new Error("Tier decision not confirmed");
}
