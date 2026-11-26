/** Review-only source observations, NOT a catalog/publication or inventory API.
 * A tier can be sold out while another tier has not opened. Never collapse this
 * collection into Festival.ticketStatus. Prices are observed, not checkout totals.
 */
export type TicketOfferProposal = {
  key: string;
  kind: "full_pass" | "day_pass";
  label: string;
  status: "sold_out" | "not_on_sale" | "unknown";
  price: { amountMinor: number; currency: "EUR"; fees: "unknown" } | null;
  // Unqualified source prose (e.g. no year/time zone) is not a timestamp.
  saleDateText: string | null;
  sourceUrl: string;
  observedAt: string;
  excerpt: string;
};
export type TicketOfferProposalBatch = {
  festivalSlug: string;
  editionYear: number;
  sourceUrl: string;
  observedAt: string;
  offers: TicketOfferProposal[];
  warnings: string[];
};

/** Public approved projection: no review IDs, actor, hash or internal excerpts. */
export type PublicTicketOffers = {
  editionYear: number;
  sourceUrl: string;
  observedAt: string;
  offers: Pick<TicketOfferProposal, "key" | "kind" | "status" | "price" | "saleDateText">[];
};
