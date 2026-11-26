import type { Festival } from "./domain/festival.ts";
import { publicEditionLifecycleSchema } from "./domain/edition-lifecycle-review.ts";

/** Absence is unknown, not a claim that the edition is active.
 * Reject transferred/malformed notices rather than advertising old inventory. */
export function editionOnHiatus(
  item: Partial<Pick<Festival, "slug" | "editionYear" | "officialUrl" | "editionLifecycle">>,
): boolean {
  if (item.editionLifecycle === undefined) return false;
  const notice = publicEditionLifecycleSchema.parse(item.editionLifecycle);
  if (
    item.slug !== notice.festivalSlug ||
    item.editionYear !== notice.editionYear ||
    item.officialUrl !== notice.sourceUrl
  )
    throw new Error("Edition lifecycle target mismatch");
  return notice.lifecycle === "hiatus";
}
