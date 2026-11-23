import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FestivalSource } from "./types.ts";

const schema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  eventName: z.string().min(1),
  eventStart: z.iso.datetime({ offset: true }),
  eventEnd: z.iso.datetime({ offset: true }),
  shopId: z.uuid(),
  eventId: z.uuid(),
  passId: z.uuid(),
  passName: z.string().min(1),
}).strict();

export type AlcatrazProof = z.infer<typeof schema> & { editionYear: number; sourceUrl: string };

function isAlcatrazPrimary(source: FestivalSource): boolean {
  return source.festivalSlug === "alcatraz" && ["https://www.alcatraz.be/", "https://www.alcatraz.be/en/"].includes(source.url)
    && !source.fetchUrl && !source.followLinkPattern && !source.strategies.includes("manual_review");
}

export function getAlcatrazProof(source: FestivalSource): AlcatrazProof | undefined {
  const proof = source.alcatrazProof;
  return isAlcatrazPrimary(source) && proof?.editionYear === source.editionYear && proof.sourceUrl === source.url ? proof : undefined;
}

export async function withAlcatrazProof<T extends FestivalSource>(db: Pick<PrismaClient, "$queryRaw">, source: T): Promise<T> {
  if (!isAlcatrazPrimary(source)) return source;
  const [row] = await db.$queryRaw<{ proof: unknown }[]>`
    SELECT "proof" FROM "ReviewedTicketProof"
    WHERE "festivalSlug" = ${source.festivalSlug} AND "sourceUrl" = ${source.url} AND "editionYear" = ${source.editionYear}
  `;
  if (!row) return source;
  return { ...source, alcatrazProof: { ...schema.parse(row.proof), editionYear: source.editionYear, sourceUrl: source.url } };
}

export const alcatrazStockUrl = (proof: AlcatrazProof) => `https://shop.api.openticket.tech/${proof.shopId}/data`;
export const alcatrazPurchaseUrl = (proof: AlcatrazProof) => `https://shop.weeztix.com/${proof.shopId}`;
