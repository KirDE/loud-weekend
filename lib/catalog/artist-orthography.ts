/** Formatting variants only: not a fuzzy name/slug identity matcher. */
export function artistOrthographyKey(name: string) {
  return name.toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/\.$/, "");
}
export function artistOrthographyVariants(name: string) {
  const stem = name.replace(/[’‘]/g, "'").replace(/\.$/, "");
  // Expand each position independently: opening/closing quotes may be mixed.
  let spellings = [""];
  for (const character of stem) {
    spellings = spellings.flatMap(prefix =>
      (character === "'" ? ["'", "’", "‘"] : [character]).map(value => prefix + value));
    // Untrusted source text must not cause exponential query growth. Fail closed.
    if (spellings.length > 1024) throw new Error("Ambiguous artist identity: excessive apostrophe variants");
  }
  return spellings.flatMap(spelling => [spelling, spelling + "."]);
}
