import type { Festival, TimetableEntry } from "./festival.ts";

export type EditionProvenance = Readonly<{
  field: "edition" | "dates" | "startDate" | "endDate" | "lineup" | "finalLineup";
  url: string;
  checkedAt: string;
  note: string;
}>;

export type FestivalEdition = Readonly<
  Omit<Festival, "editionYear" | "headliners" | "lineup" | "timetable"> & {
    headliners: readonly string[];
    lineup: readonly string[];
    timetable?: readonly TimetableEntry[];
    editionYear: number;
    recordState: "archived" | "current" | "tracking";
    completeness: "complete" | "partial" | "tba";
    snapshotAt?: string;
    provenance: readonly EditionProvenance[];
  }
>;
