import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { heavyStockResponse } from "./support/heavy-stock-fixture.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
const source = parserSource("heavy-weekend", { url: "https://www.heavyweekend.live/" });
const primary = JSON.parse(readFileSync(new URL("./fixtures/official-markup/heavy-weekend-linked-2027.json", import.meta.url), "utf8"));
const logo = readFileSync(new URL("./fixtures/official-markup/heavy-slash-logo.png", import.meta.url));
ticketProducerPublication({ slug: source.festivalSlug, produce: async archived => {
  const capture = structuredClone(primary);
  if (archived) {
    capture.home = capture.home.replaceAll("2027", "2026");
    for (const doc of capture.documents) doc.html = doc.html.replaceAll("2027", "2026");
  }
  const fetched = await fetchSource(source, { maxAttempts: 1, fetchImpl: async url => {
    const stock = heavyStockResponse(url); if (stock) return stock;
    if (url === source.url) return new Response(capture.home);
    if (String(url).includes("cdn.prod")) return new Response(logo);
    const doc = capture.documents.find((d: {url: string}) => d.url === url);
    assert.ok(doc, "unexpected Heavy source request"); return new Response(doc.html);
  } });
  assert.equal(fetched.attempts, 10);
  assert.equal(fetched.response.status, 200);
  return extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T14:00:00Z");
} });
