import type { ArtistProfile } from "./domain/artist";

export type FavoriteArtistIdentity = Pick<ArtistProfile, "slug" | "name" | "aliases">;

export const favoriteArtistKey = (slug: string) => `artist:${slug}`;

export function legacyFavoriteNames(
  artist: FavoriteArtistIdentity,
  artists: readonly FavoriteArtistIdentity[],
) {
  return [artist.name, ...artist.aliases].filter(
    (name) =>
      !artists.some(
        (other) =>
          other.slug !== artist.slug && (other.name === name || other.aliases.includes(name)),
      ),
  );
}

export function favoriteArtistLabels(
  values: readonly string[],
  artists: readonly FavoriteArtistIdentity[],
) {
  const byKey = new Map(artists.map((artist) => [favoriteArtistKey(artist.slug), artist]));
  const byName = new Map<string, FavoriteArtistIdentity | null>();
  for (const artist of artists) {
    for (const name of [artist.name, ...artist.aliases]) {
      if (!byName.has(name)) byName.set(name, artist);
      else if (byName.get(name)?.slug !== artist.slug) byName.set(name, null);
    }
  }
  const labels = new Map<string, string>();
  for (const value of values) {
    const artist = byKey.get(value) ?? byName.get(value);
    labels.set(
      artist ? favoriteArtistKey(artist.slug) : value,
      artist?.name ?? value.replace(/^artist:/, ""),
    );
  }
  return [...labels];
}
