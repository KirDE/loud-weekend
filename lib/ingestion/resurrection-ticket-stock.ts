import type { FestivalCandidate } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";

// Public GET contracts used by the official Astro shop; never carts, orders,
// reservations, queue URLs or customer endpoints. Namespace is public sale routing.
export const RESURRECTION_CONFIG = "https://oss-content-api.superstruct.services/api/v1/shops/resurrectionfest/sales/resurrection-fest-2027/config";
export const RESURRECTION_SHOP = "https://oss-shopping-api.superstruct.services/api/v2/shop?lang=en";
export const RESURRECTION_PRODUCTS = "https://oss-shopping-api.superstruct.services/api/v2/products?lang=en";
export const RESURRECTION_PURCHASE = "https://tickets.resurrectionfest.es/es/resurrection-fest-2027/4-day-tickets";
export const RESURRECTION_DOCUMENTS = "resurrection-public-stock-v1";
export const isResurrectionNamespace = (value: unknown): value is string => typeof value === "string" && /^resurrectionfest_2027_[A-Za-z0-9_-]{1,80}$/.test(value);

export function observeResurrectionStock(body: string): TicketObservation {
  const fail = (reason: string): TicketObservation => ({ excerpt: "", warning: `Official resurrection-fest ticket source requires review: ${reason}` });
  let data; try { data = JSON.parse(body); } catch { return fail("public stock envelope malformed"); }
  if (data?.kind !== RESURRECTION_DOCUMENTS || data.configUrl !== RESURRECTION_CONFIG || data.shopUrl !== RESURRECTION_SHOP || data.productsUrl !== RESURRECTION_PRODUCTS)
    return fail("public stock document identities changed");
  const config = data.config?.data?.shopSale, shop = data.shop?.data;
  if (!config || config.title !== "Resurrection Fest 2027" || !isResurrectionNamespace(config.namespace)
    || config.requireLogin !== false || config.requirePremiumMembership !== false || config.shopMode !== "no_loading")
    return fail("current public sale identity/access mode changed");
  if (!shop || shop.isOpen !== true || shop.isReadOnly !== false || shop.isAddOnShop !== false || shop.isUpgradeShop !== false
    || shop.paymentQueueEnabled !== false || shop.currency !== "EUR") return fail("ordinary shop closed, queued, read-only or changed");
  const products = data.products?.data;
  if (!Array.isArray(products) || products.length > 300) return fail("public product schema changed");
  const ordinary = products.filter(p => p?.id === "bleep_ZVcvxdk1Tyyc5xa8vL_bwQ" || p?.name === "4 Day Ticket / Abono 4 días");
  if (ordinary.length !== 1) return fail("ordinary four-day admission missing or ambiguous");
  const p = ordinary[0];
  if (p.id !== "bleep_ZVcvxdk1Tyyc5xa8vL_bwQ" || p.name !== "4 Day Ticket / Abono 4 días" || p.type !== "ticket"
    || p.claimFlow !== "regular" || p.isUpgrade !== false || p.restrictsToDay !== ""
    || !Array.isArray(p.categories) || p.categories.length !== 1 || p.categories[0]?.en !== "ENTRANCE TICKETS"
    || typeof p.price !== "number" || !Number.isFinite(p.price) || p.price <= 0
    || typeof p.soldOut !== "boolean" || typeof p.almostSoldOut !== "boolean"
    || !Number.isSafeInteger(p.stockAvailable) || !Number.isSafeInteger(p.minQuantity) || !Number.isSafeInteger(p.maxQuantity)
    || p.minQuantity < 1 || p.maxQuantity < p.minQuantity || p.stockAvailable < p.minQuantity || p.soldOut)
    return fail("ordinary admission eligibility/stock unavailable or contradictory; no global sellout inferred");
  return { status: p.almostSoldOut ? "low" : "available",
    excerpt: `Resurrection Fest 2027; ordinary four-day admission; EUR ${p.price}; open non-queued public shop; soldOut=false; almostSoldOut=${p.almostSoldOut}; stockAvailable covers minimum purchase (not total capacity)` };
}

export const RESURRECTION_ARTIST_REVIEW = "Resurrection festival lineup image requires review: no individual performer markup";
/** Keep artist review visible; only independent, already-date-matched stock may
 * publish while image-only lineup extraction is awaiting human review. */
export function isResurrectionTicketOnly(candidate: FestivalCandidate, changes: { field: string }[], year: number | undefined): boolean {
  return candidate.festivalSlug === "resurrection-fest" && candidate.sourceUrl === "https://www.resurrectionfest.es/" && year === 2027
    && candidate.observedEditionYears.length === 1 && candidate.observedEditionYears[0] === year
    && candidate.lineup === undefined && candidate.headliners === undefined
    && changes.every(c => ["ticketStatus", "ticketsUrl"].includes(c.field))
    && candidate.ticketSupplement?.sourceUrl === candidate.sourceUrl && candidate.ticketSupplement.ticketUrl === RESURRECTION_PRODUCTS
    && candidate.ticketSupplement.editionYear === year && candidate.ticketsUrl === RESURRECTION_PURCHASE
    && ["available", "low"].includes(candidate.ticketStatus ?? "");
}
