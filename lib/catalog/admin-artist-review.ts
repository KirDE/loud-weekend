/** Full Rewind cards are additive, not a replacement roster. The protected
 * ingestion review preserves saved artists/billing and defers provider work;
 * whole-field admin changes cannot express that contract, including stale ones. */
export function assertAdminArtistReviewAllowed(slug: string, fields: readonly string[]) {
  if (slug === "full-rewind" && fields.some(field => field === "lineup" || field === "headliners"))
    throw new Error("Full Rewind artist changes require protected ingestion review; admin replacement is not supported");
}
