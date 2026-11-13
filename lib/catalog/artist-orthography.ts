/** Formatting variants only: not a fuzzy name/slug identity matcher. */
export function artistOrthographyKey(name: string) {
  return name.toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/\.$/, "");
}
export function artistOrthographyVariants(name: string) {
  const stem = name.replace(/[’‘]/g, "'").replace(/\.$/, "");
  return [...new Set(["'", "’", "‘"].flatMap(quote => {
    const spelling = stem.replace(/'/g, quote);
    return [spelling, spelling + "."];
  }))];
}
