import type { AdminChange, Prisma } from "@prisma/client";
import { CanonicalReviewConflict } from "./admin-review-conflict";
import { artistAliasIndex } from "./artist-aliases";

const officialSite = { label: "Official site", source: "official" } as const;

function nameValue(value: unknown) {
  if (typeof value !== "string") throw new Error("A canonical artist name is required");
  const name = value.trim().normalize("NFC");
  if (!name || name.length > 160 || /[\p{Cc}]/u.test(name))
    throw new Error("Invalid canonical artist name");
  return name;
}

function urlValue(value: unknown) {
  let url: URL;
  try {
    if (typeof value !== "string" || value.length > 2048 || /[\p{Cc}]/u.test(value))
      throw new Error();
    url = new URL(value);
  } catch {
    throw new Error("An HTTPS official site is required");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("An HTTPS official site is required");
  return url.href;
}

async function readArtist(tx: Prisma.TransactionClient, slug: string) {
  return tx.artist.findUnique({
    where: { slug },
    include: { links: { orderBy: { position: "asc" } } },
  });
}

type Artist = NonNullable<Awaited<ReturnType<typeof readArtist>>>;

function readSite(artist: Artist) {
  const rows = artist.links.filter(
    ({ label, source }) => label === officialSite.label && source === officialSite.source,
  );
  if (rows.length > 1)
    throw new Error("Multiple official artist sites require separate reconciliation");
  return rows[0];
}

async function assertUniqueName(tx: Prisma.TransactionClient, artist: Artist, name: string) {
  const identities = await tx.artist.findMany({
    select: { id: true, slug: true, name: true, aliases: true },
  });
  if (artistAliasIndex(identities, { orthography: true })(name).some(({ id }) => id !== artist.id))
    throw new Error("The name belongs to another artist identity");
}

export async function prepareArtistDraft(
  tx: Prisma.TransactionClient,
  slug: string,
  values: Record<string, unknown>,
) {
  const artist = await readArtist(tx, slug);
  if (!artist) throw new Error("Select an existing artist by its canonical slug");
  const changes = [];
  for (const [field, value] of Object.entries(values)) {
    switch (field) {
      case "canonicalName": {
        const name = nameValue(value);
        if (name !== artist.name) await assertUniqueName(tx, artist, name);
        changes.push({ field, beforeValue: artist.name, afterValue: name });
        break;
      }
      case "officialUrl":
        changes.push({
          field,
          beforeValue: readSite(artist)?.url ?? null,
          afterValue: urlValue(value),
        });
        break;
      default:
        throw new Error("Unsupported artist field");
    }
  }
  return { artistId: artist.id, changes };
}

export async function publishAdminArtistChange(tx: Prisma.TransactionClient, change: AdminChange) {
  const evidence = change.sourceEvidence as { kind?: string; artistId?: string } | null;
  if (evidence?.kind !== "artist-draft" || typeof evidence.artistId !== "string")
    throw new Error("Resubmit this artist edit using the canonical artist editor");
  const artist = await readArtist(tx, change.resourceKey);
  if (artist?.id !== evidence.artistId)
    throw new CanonicalReviewConflict("The reviewed artist identity has changed");

  switch (change.field) {
    case "canonicalName": {
      const name = nameValue(change.afterValue);
      if (artist.name === name) return "unchanged";
      if (artist.name !== change.beforeValue)
        throw new CanonicalReviewConflict(
          "The canonical artist name changed after review was queued",
        );
      await assertUniqueName(tx, artist, name);
      const aliases = artist.aliases.includes(artist.name)
        ? artist.aliases
        : [...artist.aliases, artist.name];
      await tx.artist.update({ where: { id: artist.id }, data: { name, aliases } });
      return "published";
    }
    case "officialUrl": {
      const url = urlValue(change.afterValue);
      const existing = readSite(artist);
      if (existing?.url === url && existing.verified) return "unchanged";
      if ((existing?.url ?? null) !== change.beforeValue)
        throw new CanonicalReviewConflict(
          "The official artist site changed after review was queued",
        );
      // A reviewed official site must not overwrite an independent provider link.
      if (artist.links.some((link) => link.url === url && link.id !== existing?.id))
        throw new Error("This URL already belongs to a different artist link");
      if (existing) {
        await tx.artistLink.update({ where: { id: existing.id }, data: { url, verified: true } });
      } else {
        const position = (artist.links.at(-1)?.position ?? -1) + 1;
        await tx.artistLink.create({
          data: { artistId: artist.id, url, ...officialSite, verified: true, position },
        });
      }
      const provenance = await tx.artistProvenance.findFirst({
        where: { artistId: artist.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      await tx.artistProvenance.create({
        data: {
          artistId: artist.id,
          field: "officialUrl",
          source: "official",
          url,
          checkedAt: new Date(),
          position: (provenance?.position ?? -1) + 1,
        },
      });
      return "published";
    }
    default:
      throw new Error("Unsupported artist field");
  }
}
