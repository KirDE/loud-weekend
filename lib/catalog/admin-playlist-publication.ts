import type { AdminChange, Prisma } from "@prisma/client";
import { YOUTUBE_URL } from "./youtube-playlist-queue";

const spotifyUrl = /^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/;

function playlistValue(value: unknown, provider: string) {
  // An explicit removal restores the provider-managed link, if one exists.
  if (value === null) return null;
  const pattern = provider === "spotify" ? spotifyUrl : YOUTUBE_URL;
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value))
    throw new Error("Enter a canonical HTTPS playlist URL for the selected provider");
  return value;
}

async function readScope(tx: Prisma.TransactionClient, key: string) {
  const [slug, year, provider, extra] = key.split(":");
  if (
    !slug ||
    !/^\d{4}$/.test(year) ||
    extra !== undefined ||
    (provider !== "spotify" && provider !== "youtube_music")
  )
    throw new Error("Select a festival edition and playlist provider");
  const edition = await tx.festivalEdition.findFirst({
    where: { festival: { slug }, year: Number(year), recordState: "CURRENT" },
    select: { id: true },
  });
  if (!edition) throw new Error("The reviewed playlist edition is no longer current");
  const scope = { editionId: edition.id, provider };
  const existing = await tx.festivalPlaylistLink.findUnique({
    where: { editionId_provider: scope },
  });
  return { scope, url: existing?.url ?? null };
}

export async function preparePlaylistDraft(
  tx: Prisma.TransactionClient,
  key: string,
  values: Record<string, unknown>,
) {
  if (Object.keys(values).length !== 1 || !Object.hasOwn(values, "url"))
    throw new Error("Review one public playlist link or removal at a time");
  const { scope, url } = await readScope(tx, key);
  return {
    editionId: scope.editionId,
    changes: [
      { field: "url", beforeValue: url, afterValue: playlistValue(values.url, scope.provider) },
    ],
  };
}

export async function publishAdminPlaylistChange(
  tx: Prisma.TransactionClient,
  change: AdminChange,
) {
  const evidence = change.sourceEvidence as { kind?: string; editionId?: string } | null;
  if (change.field !== "url" || evidence?.kind !== "playlist-draft" || !evidence.editionId)
    throw new Error("Resubmit this playlist edit for a specific edition and provider");
  const { scope, url } = await readScope(tx, change.resourceKey);
  if (scope.editionId !== evidence.editionId)
    throw new Error("The reviewed playlist edition has changed");
  const next = playlistValue(change.afterValue, scope.provider);
  if (url === next) return "unchanged";
  if (url !== change.beforeValue)
    throw new Error("The public playlist link changed after review was queued");

  const where = { editionId_provider: scope };
  if (next === null) {
    await tx.festivalPlaylistLink.delete({ where });
    return "removed";
  }
  await tx.festivalPlaylistLink.upsert({
    where,
    create: { ...scope, url: next },
    update: { url: next },
  });
  return "published";
}
