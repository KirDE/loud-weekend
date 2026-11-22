export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function editionDateProblem(year: number | undefined, start: unknown, end: unknown) {
  if ((start != null && !isCalendarDate(start)) || (end != null && !isCalendarDate(end)))
    return "Festival dates must be valid calendar dates";
  if (isCalendarDate(start) && isCalendarDate(end) && start > end)
    return "Festival end date cannot precede the start date";
  if (year === undefined) return;
  const startYear = isCalendarDate(start) ? Number(start.slice(0, 4)) : undefined;
  const endYear = isCalendarDate(end) ? Number(end.slice(0, 4)) : undefined;
  // Editions are keyed by the start year. A dated December–January range
  // can cross New Year; an end date alone cannot establish that rollover.
  const newYearRollover = startYear === year && endYear === year + 1 &&
    isCalendarDate(start) && start.slice(5, 7) === "12" &&
    isCalendarDate(end) && end.slice(5, 7) === "01";
  if ((startYear !== undefined && startYear !== year) || (endYear !== undefined && endYear !== year && !newYearRollover))
    return "Festival dates must match the edition year";
}
