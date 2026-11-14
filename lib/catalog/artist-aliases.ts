import { artistOrthographyKey } from "./artist-orthography.ts";

export type AliasArtist = { id: string; slug: string; name: string; aliases: string[] };

/** Global DB identities, including archived/unlisted artists. Never fuzzy-match. */
export function artistAliasIndex(artists: AliasArtist[], options: { orthography?: boolean } = {}) {
  const identityKey = options.orthography ? (name: string) => artistOrthographyKey(name.normalize("NFC")) : (name: string) => name.trim().normalize("NFC").toLocaleLowerCase();
  const index = new Map<string, Map<string, AliasArtist>>();
  const add = (artist: AliasArtist) => { for (const name of [artist.name, ...artist.aliases]) {
    const key = identityKey(name);
    const owners = index.get(key) ?? new Map<string, AliasArtist>();
    owners.set(artist.id, artist);
    index.set(key, owners);
  }
  };
  artists.forEach(add);
  return Object.assign((name: string) => [...(index.get(identityKey(name))?.values() ?? [])], { add });
}

/** Canonicalize only unambiguous, one-to-one roster entries. Keep evidence raw. */
export function canonicalArtistNames(names: string[], artists: AliasArtist[]) {
  const lookup = artistAliasIndex(artists);
  const warnings: string[] = [];
  const resolved = names.map(name => {
    const owners = lookup(name);
    if (owners.length > 1) warnings.push(`Ambiguous artist alias: ${name}`);
    return owners.length === 1 ? owners[0].name : name;
  });
  const keys = resolved.map(name => name.trim().normalize("NFC").toLocaleLowerCase());
  if (new Set(keys).size !== keys.length) {
    // Do not collapse two entries (possibly in different billing groups).
    warnings.push("Duplicate artist alias identities require review");
    return { names, warnings };
  }
  return { names: resolved, warnings };
}
