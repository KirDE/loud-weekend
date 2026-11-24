import { z } from "zod";
import type { AdminChange, Prisma } from "@prisma/client";
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
  const artist = await tx.artist.findUnique({
    where: { slug },
    include: { links: { orderBy: { position: "asc" } } },
  });
  if (!artist) throw new Error("Select an existing artist by its canonical slug");
  return artist;
}

type Artist = Awaited<ReturnType<typeof readArtist>>;

function readSite(artist: Artist) {
  const rows = artist.links.filter(
    ({ label, source }) => label === officialSite.label && source === officialSite.source,
  );
  if (rows.length > 1)
    throw new Error("Multiple official artist sites require separate reconciliation");
  return rows[0];
}

const socialHost =
  /^(?:www\.)?(?:instagram\.com|facebook\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com)$/;
const observation = {
  sourceUrl: z.string().max(2048),
  observedAt: z.string().datetime({ offset: true }),
};
const linkProof = z.strictObject({ url: z.string().max(2048), ...observation });
const biographyProof = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .max(1200)
    .refine((text) => !/[\p{Cc}]/u.test(text)),
  ...observation,
});

function officialObservation(artist: Artist, proof: { sourceUrl: string; observedAt: string }) {
  const site = readSite(artist);
  const evidence = new URL(urlValue(proof.sourceUrl));
  if (
    !site?.verified ||
    evidence.origin !== new URL(urlValue(site.url)).origin ||
    evidence.search ||
    evidence.hash
  ) {
    throw new Error("Use a public source on the verified artist site");
  }
  const observedAt = new Date(proof.observedAt);
  if (observedAt.getTime() > Date.now()) throw new Error("Observation cannot be in the future");
  return { site, sourceUrl: evidence.href, observedAt: observedAt.toISOString() };
}

async function reviewBiography(tx: Prisma.TransactionClient, artist: Artist, value: unknown) {
  const { text, ...observation } = biographyProof.parse(value);
  if (artist.identityState === "AMBIGUOUS")
    throw new Error("Resolve the artist identity before reviewing a biography");
  const { site, sourceUrl, observedAt } = officialObservation(artist, observation);
  const previous = await tx.artistProvenance.findFirst({
    where: { artistId: artist.id, field: "biography" },
    orderBy: [{ checkedAt: "desc" }, { position: "desc" }, { id: "desc" }],
    select: { id: true, checkedAt: true, url: true, source: true },
  });
  const unchanged =
    artist.biography === text &&
    previous?.url === sourceUrl &&
    previous.source === "official" &&
    previous.checkedAt.toISOString() === observedAt;
  if (previous && observedAt <= previous.checkedAt.toISOString() && !unchanged) {
    throw new Error("A revised biography needs a newer source observation");
  }
  return {
    before: {
      text: artist.biography,
      siteId: site.id,
      siteUrl: site.url,
      proofId: previous?.id ?? null,
    },
    proof: { text, sourceUrl, observedAt },
    unchanged,
  };
}

async function appendOfficialProof(
  tx: Prisma.TransactionClient,
  artistId: string,
  field: string,
  url: string,
  checkedAt: Date,
) {
  const previous = await tx.artistProvenance.findFirst({
    where: { artistId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await tx.artistProvenance.create({
    data: {
      artistId,
      field,
      source: "official",
      url,
      checkedAt,
      position: (previous?.position ?? -1) + 1,
    },
  });
}

function reviewSocialLink(artist: Artist, value: unknown) {
  const proof = linkProof.parse(value);
  const candidate = artist.links.find(({ url }) => url === proof.url);
  if (!candidate || candidate.label !== "Social profile" || candidate.source !== "musicbrainz") {
    throw new Error("Choose an existing provider-discovered social profile for this artist");
  }
  const url = new URL(urlValue(candidate.url));
  const { site, sourceUrl, observedAt } = officialObservation(artist, proof);
  if (
    !socialHost.test(url.hostname) ||
    url.port ||
    url.pathname === "/" ||
    url.search ||
    url.hash ||
    sourceUrl === url.href
  ) {
    throw new Error(
      "Use a supported social profile and a public source on the verified artist site",
    );
  }
  return { candidate, site, proof: { ...proof, sourceUrl, observedAt } };
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
      case "biography": {
        const { before, proof } = await reviewBiography(tx, artist, value);
        changes.push({ field, beforeValue: before, afterValue: proof });
        break;
      }
      case "socialProfile": {
        const { candidate, site, proof } = reviewSocialLink(artist, value);
        changes.push({
          field,
          beforeValue: {
            id: candidate.id,
            verified: candidate.verified,
            siteId: site.id,
            siteUrl: site.url,
          },
          afterValue: proof,
        });
        break;
      }
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
  if (artist.id !== evidence.artistId) throw new Error("The reviewed artist identity has changed");

  switch (change.field) {
    case "canonicalName": {
      const name = nameValue(change.afterValue);
      if (artist.name === name) return "unchanged";
      if (artist.name !== change.beforeValue)
        throw new Error("The canonical artist name changed after review was queued");
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
        throw new Error("The official artist site changed after review was queued");
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
      await appendOfficialProof(tx, artist.id, "officialUrl", url, new Date());
      return "published";
    }
    case "biography": {
      const { before, proof, unchanged } = await reviewBiography(tx, artist, change.afterValue);
      const expected = change.beforeValue as Partial<typeof before> | null;
      if (
        expected?.text !== before.text ||
        expected.siteId !== before.siteId ||
        expected.siteUrl !== before.siteUrl ||
        expected.proofId !== before.proofId
      ) {
        throw new Error("The biography or official source changed after review was queued");
      }
      if (unchanged) return "unchanged";
      await tx.artist.update({ where: { id: artist.id }, data: { biography: proof.text } });
      await appendOfficialProof(
        tx,
        artist.id,
        "biography",
        proof.sourceUrl,
        new Date(proof.observedAt),
      );
      return "published";
    }
    case "socialProfile": {
      const { candidate, site, proof } = reviewSocialLink(artist, change.afterValue);
      const before = change.beforeValue as {
        id?: string;
        verified?: boolean;
        siteId?: string;
        siteUrl?: string;
      } | null;
      if (before?.id !== candidate.id || before.siteId !== site.id || before.siteUrl !== site.url) {
        throw new Error("Artist link or official source changed after review was queued");
      }
      if (candidate.verified) return "unchanged";
      if (before.verified !== candidate.verified)
        throw new Error("Artist link changed after review was queued");
      await tx.artistLink.update({ where: { id: candidate.id }, data: { verified: true } });
      await appendOfficialProof(
        tx,
        artist.id,
        "links",
        proof.sourceUrl,
        new Date(proof.observedAt),
      );
      return "published";
    }
    default:
      throw new Error("Unsupported artist field");
  }
}
