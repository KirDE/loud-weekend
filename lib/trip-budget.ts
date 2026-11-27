import type { Festival } from "./domain/festival.ts";
import { z } from "zod";

export const budgetCurrencies = [
  "EUR",
  "GBP",
  "CHF",
  "PLN",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "HUF",
  "RON",
] as const;
export const budgetCostFields = ["ticket", "travel", "lodging", "camping", "food"] as const;
export const budgetCountFields = ["people", "nights", "days"] as const;
export const budgetKey = (slug: string, editionYear: number) => `${slug}:${editionYear}`;

export const maxTripBudgets = 100;
const maxCents = 10_000_000;
const cents = z.number().int().min(0).max(maxCents);
const daysOrNights = z.number().int().min(0).max(60);
export const tripBudgetSchema = z
  .object({
    currency: z.enum(budgetCurrencies),
    people: z.number().int().min(1).max(50),
    nights: daysOrNights,
    days: daysOrNights,
    ticket: cents.optional(),
    travel: cents.optional(),
    lodging: cents.optional(),
    camping: cents.optional(),
    food: cents.optional(),
  })
  .strict();
export const tripBudgetsSchema = z
  .record(z.string().regex(/^[a-z0-9-]{1,120}:\d{4}$/), tripBudgetSchema)
  .refine((plans) => Object.keys(plans).length <= maxTripBudgets);
export type TripBudget = z.infer<typeof tripBudgetSchema>;
export type TripBudgets = z.infer<typeof tripBudgetsSchema>;
export const initialBudget: TripBudget = { currency: "EUR", people: 1, nights: 1, days: 1 };

export function readTripBudgets(value: unknown): TripBudgets {
  return tripBudgetsSchema.safeParse(value).data ?? {};
}

export function parseBudgetCost(value: string): number | undefined {
  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(value.trim())) return undefined;
  const [major, minor = ""] = value.trim().split(/[.,]/);
  const total = Number(major) * 100 + Number(minor.padEnd(2, "0"));
  return total <= maxCents ? total : undefined;
}

/** A reference from the approved public projection, never proof of stock or a checkout total. */
export function budgetTicketReference(festival: Festival | undefined) {
  const published = festival?.ticketOffers;
  if (
    !published ||
    published.editionYear !== festival.editionYear ||
    festival.editionLifecycle?.lifecycle === "hiatus" ||
    ["free", "sold_out", "sales_ended", "unavailable"].includes(festival.ticketStatus)
  )
    return undefined;

  const fullPasses = published.offers.filter(({ kind }) => kind === "full_pass");
  if (fullPasses.length !== 1) return undefined;
  const [offer] = fullPasses;
  if (
    offer.status === "sold_out" ||
    !offer.price ||
    !cents.safeParse(offer.price.amountMinor).success
  )
    return undefined;
  return {
    price: offer.price,
    sourceUrl: published.sourceUrl,
    observedAt: published.observedAt,
  };
}

export function budgetTotal(plan: TripBudget): number | undefined {
  const { ticket, travel, lodging, camping, food, people, days, nights } = plan;
  if ([ticket, travel, lodging, camping, food].every((value) => value === undefined))
    return undefined;
  return (
    (ticket ?? 0) * people +
    (travel ?? 0) +
    ((lodging ?? 0) + (camping ?? 0)) * nights +
    (food ?? 0) * days * people
  );
}
