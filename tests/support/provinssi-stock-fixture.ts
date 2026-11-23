import { readFileSync } from "node:fs";
import { PROVINSSI_SALE_API, PROVINSSI_STOCK } from "../../lib/ingestion/provinssi-ticket-stock.ts";
export const provinssiSale = JSON.parse(
  readFileSync(new URL("../fixtures/ticket-status/provinssi-sale.json", import.meta.url), "utf8"),
);
export const provinssiStore = JSON.parse(
  readFileSync(new URL("../fixtures/ticket-status/provinssi-store.json", import.meta.url), "utf8"),
);
export function provinssiStockResponse(url: string | URL | Request) {
  if (String(url) === PROVINSSI_SALE_API) return Response.json(provinssiSale);
  if (String(url) === PROVINSSI_STOCK) return Response.json(provinssiStore);
}
