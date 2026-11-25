import type { Festival } from "./domain/festival.ts";

export type SuggestionArtist = { slug: string; name: string; aliases: readonly string[] };
export type SearchSuggestion = {
  id: string;
  label: string;
  detail?: string;
  href?: string;
  value?: string;
};

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function oneEdit(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index++;
  if (shorter.length !== longer.length) return shorter.slice(index) === longer.slice(index + 1);
  return (
    shorter.slice(index + 1) === longer.slice(index + 1) ||
    (shorter[index] === longer[index + 1] &&
      shorter[index + 1] === longer[index] &&
      shorter.slice(index + 2) === longer.slice(index + 2))
  );
}

function score(needle: string, haystack: string) {
  if (needle === haystack) return 0;
  if (haystack.startsWith(needle)) return 1;
  if (haystack.includes(needle)) return 2;
  if (needle.length >= 4 && oneEdit(needle, haystack)) return 3;
  return Infinity;
}

export function discoverySuggestionIndex(
  festivals: readonly Festival[],
  artists: readonly SuggestionArtist[],
) {
  const uniqueCities = new Map<string, SearchSuggestion>();
  for (const festival of festivals) {
    if (!festival.city) continue;
    const id = `${festival.countryCode}:${normalized(festival.city)}`;
    uniqueCities.set(id, {
      id,
      label: festival.city,
      detail: festival.countryCode,
      value: festival.city,
    });
  }
  const index = {
    artists: artists.map(({ slug, name, aliases }) => ({
      suggestion: { id: slug, label: name, href: `/artists/${slug}/` },
      terms: [name, ...aliases].map(normalized),
    })),
    festivals: festivals.map(({ slug, name, countryCode }) => ({
      suggestion: { id: slug, label: name, detail: countryCode, href: `/festivals/${slug}/` },
      terms: [normalized(name)],
    })),
    cities: [...uniqueCities.values()].map((suggestion) => ({
      suggestion,
      terms: [normalized(suggestion.label)],
    })),
  };
  return index;
}

export function discoverySuggestions(
  query: string,
  index: ReturnType<typeof discoverySuggestionIndex>,
  locale: string,
) {
  const needle = normalized(query);
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  const top = (entries: readonly { suggestion: SearchSuggestion; terms: readonly string[] }[]) => {
    if (needle.length < 2 || needle.length > 80) return [];
    return entries
      .map(({ suggestion, terms }) => ({
        suggestion,
        rank: Math.min(...terms.map((term) => score(needle, term))),
      }))
      .filter(({ rank }) => Number.isFinite(rank))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          collator.compare(a.suggestion.label, b.suggestion.label) ||
          a.suggestion.id.localeCompare(b.suggestion.id, "en"),
      )
      .slice(0, 4)
      .map(({ suggestion }) => suggestion);
  };
  return {
    artists: top(index.artists),
    festivals: top(index.festivals),
    cities: top(index.cities),
  };
}
