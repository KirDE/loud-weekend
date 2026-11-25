const prefix = "artist:";

export function favoriteArtistKey(slug: string) {
  return prefix + slug;
}

export function favoriteArtistSlug(key: string, legacySlugs: Readonly<Record<string, string>>) {
  if (key.startsWith(prefix)) return key.slice(prefix.length);
  return Object.hasOwn(legacySlugs, key) ? legacySlugs[key] : undefined;
}

export function toggleFavoriteArtist(
  favorites: string[],
  slug: string,
  legacySlugs: Readonly<Record<string, string>>,
) {
  const others = favorites.filter((key) => favoriteArtistSlug(key, legacySlugs) !== slug);
  return others.length === favorites.length ? [...others, favoriteArtistKey(slug)] : others;
}
