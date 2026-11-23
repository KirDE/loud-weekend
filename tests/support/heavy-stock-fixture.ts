import { readFileSync } from "node:fs";
import { HEAVY_WIDGET, HEAVY_WIDGET_API, HEAVY_STOCK } from "../../lib/ingestion/heavy-ticket-stock.ts";
export const heavyStockHtml = readFileSync(new URL("../fixtures/ticket-status/heavy-ordinary-stock.html", import.meta.url), "utf8");
/** Synthetic test token: never a captured provider credential. */
export function heavyMetadata(claims: Record<string, unknown> = {}) {
  const data = JSON.parse(readFileSync(new URL("../fixtures/ticket-status/heavy-widget-public.json", import.meta.url), "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const tokenClaims = { iat: now, nbf: now, exp: now + 300, iss: "synthetic-test-issuer", sub: "synthetic-test-render", rank: 1, access: true,
    event_id: 2166331, widget_key: HEAVY_WIDGET, widget_data: {}, ...claims };
  data.first_step.data.actions[0].args[0].parameters.token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") + "." +
    Buffer.from(JSON.stringify(tokenClaims)).toString("base64url") + ".c3ludGhldGljLXRlc3Qtb25seQ";
  return data;
}
export function heavyStockResponse(url: string | URL | Request): Response | undefined {
  if (String(url) === HEAVY_WIDGET_API) return Response.json(heavyMetadata());
  if (String(url) === HEAVY_STOCK) return new Response(heavyStockHtml, { headers: { "content-type": "text/html" } });
}
