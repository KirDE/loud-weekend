export function formatFreshnessDate(instant: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(instant));
}
