import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FestivalSource } from "./types.ts";

const datesSchema = z.object({ startDate: z.iso.date(), endDate: z.iso.date(), eventName: z.string().min(1) });
const summerSchema = datesSchema.extend({
  eventStart: z.iso.datetime({ local: true }),
  eventEnd: z.iso.datetime({ local: true }),
  saleStart: z.iso.datetime({ local: true }),
  saleEnd: z.iso.datetime({ local: true }),
}).strict();
const provinssiSchema = datesSchema.extend({
  eventStart: z.iso.datetime({ offset: true }),
  eventEnd: z.iso.datetime({ offset: true }),
  categoryName: z.string().min(1),
}).strict();

type Binding = { sourceUrl: string; editionYear: number };
export type SummerStockDates = z.infer<typeof summerSchema> & Binding;
export type ProvinssiStockDates = z.infer<typeof provinssiSchema> & Binding;

function isSummerSource(source: FestivalSource): boolean {
  return source.festivalSlug === "summer-punch" && source.url === "https://summerpunchfestival.pl/";
}

function isProvinssiSource(source: FestivalSource): boolean {
  return source.festivalSlug === "provinssi" && source.url === "https://www.provinssi.fi/en/";
}

function matches(source: FestivalSource, binding: Binding | undefined): boolean {
  return source.strategies.includes("official_markup") && !source.fetchUrl && !source.followLinkPattern
    && binding?.sourceUrl === source.url && source.editionYear === binding.editionYear;
}

export function getSummerDates(source: FestivalSource): SummerStockDates | undefined {
  return isSummerSource(source) && matches(source, source.summerDates) ? source.summerDates : undefined;
}

export function getProvinssiDates(source: FestivalSource): ProvinssiStockDates | undefined {
  return isProvinssiSource(source) && matches(source, source.provinssiDates) ? source.provinssiDates : undefined;
}

export async function withFestivalStockDates<T extends FestivalSource>(db: Pick<PrismaClient, "$queryRaw">, source: T): Promise<T> {
  const summer = isSummerSource(source);
  const binding = { sourceUrl: source.url, editionYear: source.editionYear };
  if ((!summer && !isProvinssiSource(source)) || !matches(source, binding)) return source;
  const [row] = await db.$queryRaw<{ proof: unknown }[]>`
    SELECT "proof" FROM "ReviewedTicketProof"
    WHERE "festivalSlug" = ${source.festivalSlug} AND "sourceUrl" = ${source.url} AND "editionYear" = ${source.editionYear}
  `;
  if (!row) return source;
  return summer
    ? { ...source, summerDates: { ...summerSchema.parse(row.proof), ...binding } }
    : { ...source, provinssiDates: { ...provinssiSchema.parse(row.proof), ...binding } };
}
