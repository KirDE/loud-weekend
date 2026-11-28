import type { Festival, TimetableEntry } from "./festival.ts";

export type EditionProvenance = Readonly<{
  // Persisted evidence can include older or newly introduced field identifiers.
  field: string;
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
