import type { AdminChange, Prisma } from "@prisma/client";
import sharp from "sharp";
import { validateLogo, type LogoMimeType } from "./logo-assets";

function hashValue(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Select a stored logo by its SHA-256 hash");
  return value;
}

async function readFestival(tx: Prisma.TransactionClient, slug: string) {
  return tx.festival.findUniqueOrThrow({
    where: { slug },
    select: { id: true, logo: { select: { assetHash: true } } },
  });
}

async function readLogo(tx: Prisma.TransactionClient, hash: string) {
  const asset = await tx.assetBlob.findUnique({ where: { sha256: hash } });
  if (!asset) throw new Error("The reviewed logo is not in the catalogue asset store");
  const logo = validateLogo(asset.bytes, asset.mimeType as LogoMimeType);
  if (logo.sha256 !== hash || logo.sizeBytes !== asset.sizeBytes)
    throw new Error("Stored logo does not match its content hash");
  return logo;
}

export async function prepareLogoDraft(
  tx: Prisma.TransactionClient,
  slug: string,
  values: Record<string, unknown>,
) {
  if (Object.keys(values).length !== 1)
    throw new Error("A logo draft must select one stored asset");
  const hash = hashValue(values.logoAssetHash);
  const festival = await readFestival(tx, slug);
  await readLogo(tx, hash);
  return {
    festivalId: festival.id,
    changes: [
      { field: "logoAssetHash", beforeValue: festival.logo?.assetHash ?? null, afterValue: hash },
    ],
  };
}

export async function publishAdminLogoChange(tx: Prisma.TransactionClient, change: AdminChange) {
  const evidence = change.sourceEvidence as { kind?: string; festivalId?: string } | null;
  if (change.field !== "logoAssetHash" || evidence?.kind !== "logo-draft" || !evidence.festivalId)
    throw new Error("Resubmit this logo edit with the hash of a reviewed stored asset");
  const festival = await readFestival(tx, change.resourceKey);
  if (festival.id !== evidence.festivalId)
    throw new Error("The reviewed festival identity has changed");
  const assetHash = hashValue(change.afterValue);
  const current = festival.logo?.assetHash ?? null;
  if (current !== assetHash && current !== change.beforeValue)
    throw new Error("The festival logo changed after review was queued");
  const { image } = await readLogo(tx, assetHash);
  // A content hash and signature alone do not prove the image can be decoded.
  await sharp(image, { limitInputPixels: 4_194_304, failOn: "warning" }).raw().toBuffer();
  if (current === assetHash) return "unchanged";
  await tx.festivalLogo.upsert({
    where: { festivalId: festival.id },
    create: { festivalId: festival.id, assetHash },
    update: { assetHash },
  });
  return "published";
}
