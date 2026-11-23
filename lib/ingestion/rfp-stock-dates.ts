import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FestivalSource } from "./types.ts";

const schema = z.object({
  festivalStart: z.iso.date(),
  festivalEnd: z.iso.date(),
  saleStart: z.iso.datetime({ offset: true }),
  scheduleStart: z.iso.datetime({ offset: true }),
  scheduleEnd: z.iso.datetime({ offset: true }),
  rateStart: z.iso.datetime({ offset: true }),
}).strict();
export type RfpStockDates = z.infer<typeof schema>;

export function isRfpStockSource(source: FestivalSource): boolean {
  return source.festivalSlug === "rock-for-people" && source.url === "https://rockforpeople.cz/"
    && source.editionYear === 2027 && source.strategies.includes("official_markup");
}

export async function withRfpStockDates<T extends FestivalSource>(db: Pick<PrismaClient, "$queryRaw">, source: T): Promise<T> {
  if (!isRfpStockSource(source)) return source;
  const [row] = await db.$queryRaw<{ dates: unknown }[]>`
    SELECT "dates" FROM "ReviewedTicketSchedule"
    WHERE "sourceUrl" = ${source.url} AND "editionYear" = ${source.editionYear}
  `;
  return { ...source, rfpStockDates: schema.parse(row?.dates) };
}
