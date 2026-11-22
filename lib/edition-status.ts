import type { FestivalEdition } from "./domain/edition.ts";
import { festivalDateInterval } from "./festival-dates.ts";
import { hasAnnouncedLineup } from "./festival-lineup.ts";

type EditionStatusFacts = Pick<FestivalEdition, "completeness" | "startDate" | "endDate" | "headliners" | "lineup">;

export function editionRecordCompleteness(edition: EditionStatusFacts): FestivalEdition["completeness"] {
  // Known dates or acts may precede an editorial update to the stored
  // completeness. This says nothing about whether the lineup is final.
  if (edition.completeness === "tba" && (festivalDateInterval(edition) || hasAnnouncedLineup(edition)))
    return "partial";
  return edition.completeness;
}
