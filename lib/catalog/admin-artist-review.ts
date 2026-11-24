/** Full Rewind, Provinssi and Summer Punch cards are additive, not a replacement roster. The protected
 * ingestion review preserves saved artists/billing and defers provider work;
 * whole-field admin changes cannot express that contract, including stale ones. */
export function assertAdminArtistReviewAllowed(slug: string, fields: readonly string[]) {
  if (
    ["full-rewind", "provinssi", "summer-punch", "area53"].includes(slug) &&
    fields.some((field) => field === "lineup" || field === "headliners")
  )
    throw new Error(
      (slug === "area53"
        ? "Area 53"
        : slug === "summer-punch"
          ? "Summer Punch"
          : slug === "provinssi"
            ? "Provinssi"
            : "Full Rewind") +
        " artist changes require protected ingestion review; admin re" +
        "placement is not supported",
    );
}
