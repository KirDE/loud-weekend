import { ROSKILDE_PRODUCTS_URL, matchesRoskildeStockEdition } from "./roskilde-stock.ts";
import { TOLMINATOR_PRODUCT, matchesTolminatorStockEdition } from "./tolminator-stock.ts";

// Reviewed endpoints share the same ticket-only publication and health contract.
export const stockProofSources = [
  { url: TOLMINATOR_PRODUCT, matchesEdition: matchesTolminatorStockEdition },
  { url: ROSKILDE_PRODUCTS_URL, matchesEdition: matchesRoskildeStockEdition },
];
