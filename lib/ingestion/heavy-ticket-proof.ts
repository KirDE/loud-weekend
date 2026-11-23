import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FestivalSource } from "./types.ts";

const schema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  widgetId: z.uuid(),
  eventId: z.number().int().positive(),
  eventName: z.string().min(1),
  eventStart: z.iso.datetime({ offset: true }),
  categoryId: z.number().int().positive(),
  subcategoryId: z.number().int().positive(),
  rateId: z.number().int().positive(),
}).strict();

export type HeavyProof = z.infer<typeof schema> & { editionYear: number; sourceUrl: string };

function isHeavyPrimary(source: FestivalSource): boolean {
  return source.festivalSlug === "heavy-weekend" && source.url === "https://www.heavyweekend.live/" && source.strategies.includes("official_markup")
    && !source.fetchUrl && !source.followLinkPattern && !source.strategies.includes("manual_review");
}

export function getHeavyProof(source: FestivalSource): HeavyProof | undefined {
  const proof = source.heavyProof;
  return isHeavyPrimary(source) && proof?.editionYear === source.editionYear && proof.sourceUrl === source.url ? proof : undefined;
}

export async function withHeavyProof<T extends FestivalSource>(db: Pick<PrismaClient, "$queryRaw">, source: T): Promise<T> {
  if (!isHeavyPrimary(source)) return source;
  const [row] = await db.$queryRaw<{ proof: unknown }[]>`
    SELECT "proof" FROM "ReviewedTicketProof"
    WHERE "festivalSlug" = ${source.festivalSlug} AND "sourceUrl" = ${source.url} AND "editionYear" = ${source.editionYear}
  `;
  if (!row) return source;
  return { ...source, heavyProof: { ...schema.parse(row.proof), editionYear: source.editionYear, sourceUrl: source.url } };
}

export const heavyWidgetApi = (proof: HeavyProof) => `https://api.weezevent.com/ticket/widgets/${proof.widgetId}`;
export const heavyStockUrl = (proof: HeavyProof) => `https://www.weezevent.com/widget_billeterie.php?id_evenement=${proof.eventId}&widget_key=${proof.widgetId}&locale=en_GB&color_primary=000000`;
export const heavyPurchaseUrl = (proof: HeavyProof) => `https://widget.weezevent.com/ticket/${proof.widgetId}?locale=fr-fr`;
