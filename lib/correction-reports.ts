import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { officialCorrectionUrl, type CorrectionReportInput } from "./correction-report-input";

export function correctionReporterHash(headers: Headers, secret: string) {
  const candidate = headers.get("x-real-ip")?.trim() ?? "";
  const address = isIP(candidate) ? candidate.toLowerCase() : "unknown";
  return createHmac("sha256", secret).update(`corrections:${address}`).digest("hex");
}

async function resolveTarget(database: PrismaClient, input: CorrectionReportInput) {
  if (input.target === "edition") {
    const edition = await database.festivalEdition.findFirst({
      where: { festival: { slug: input.slug }, year: input.year },
      select: {
        id: true,
        year: true,
        ticketsUrl: true,
        festival: { select: { name: true, officialUrl: true } },
      },
    });
    return edition
      ? {
          targetName: edition.festival.name,
          editionId: edition.id,
          editionYear: edition.year,
          artistId: null,
          knownUrls:
            input.kind === "TICKETS"
              ? [edition.festival.officialUrl, edition.ticketsUrl]
              : [edition.festival.officialUrl],
        }
      : null;
  }

  const artist = await database.artist.findFirst({
    where: { slug: input.slug, appearances: { some: { edition: { recordState: "CURRENT" } } } },
    select: {
      id: true,
      name: true,
      links: { where: { source: "official", verified: true }, select: { url: true } },
      appearances: {
        where: { edition: { recordState: "CURRENT" } },
        select: { edition: { select: { festival: { select: { officialUrl: true } } } } },
      },
    },
  });
  return artist
    ? {
        targetName: artist.name,
        editionId: null,
        editionYear: null,
        artistId: artist.id,
        knownUrls: [
          ...artist.links.map((link) => link.url),
          ...artist.appearances.map((appearance) => appearance.edition.festival.officialUrl),
        ],
      }
    : null;
}

export async function submitCorrection(
  database: PrismaClient,
  input: CorrectionReportInput,
  reporterHash: string,
) {
  const target = await resolveTarget(database, input);
  if (!target) return "missing";
  const { knownUrls, ...identity } = target;
  const sourceUrl = officialCorrectionUrl(input.sourceUrl, knownUrls);
  if (!sourceUrl) return "source";

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        identity.editionId ?? identity.artistId,
        input.target,
        input.kind,
        sourceUrl,
        input.notes.replace(/\s+/g, " "),
      ]),
    )
    .digest("hex");

  return database.$transaction(async (tx) => {
    // Serialize admissions to make global limits and deduplication hold across workers.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('loud-weekend-correction-intake'))`;
    const now = Date.now();
    const recent = { submittedAt: { gte: new Date(now - 60 * 60 * 1000) } };
    if (
      (await tx.correctionReport.count({ where: recent })) >= 100 ||
      (await tx.correctionReport.count({ where: { ...recent, reporterHash } })) >= 5
    )
      return "limited";
    const existing = await tx.correctionReport.findFirst({
      where: { fingerprint, submittedAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (existing) return "duplicate";
    await tx.correctionReport.create({
      data: {
        ...identity,
        kind: input.kind,
        sourceUrl,
        notes: input.notes || null,
        fingerprint,
        reporterHash,
      },
    });
    return "accepted";
  });
}

export async function decideCorrection(
  database: PrismaClient,
  id: string,
  reviewerId: string,
  status: "ACCEPTED" | "DISMISSED",
) {
  const result = await database.correctionReport.updateMany({
    where: { id, status: "PENDING" },
    data: { status, reviewerId, reviewedAt: new Date() },
  });
  return result.count === 1;
}
