import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
import { RFP_STOCK } from "../lib/ingestion/rfp-ticket-stock.ts";
const baseSource = parserSource("rock-for-people", { url: "https://rockforpeople.cz/" });
const home = readFileSync(new URL("./fixtures/official-markup/rfp-current-20261103.html", import.meta.url), "utf8");
const stock = readFileSync(new URL("./fixtures/ticket-status/rfp-public-sales.json", import.meta.url), "utf8");
ticketProducerPublication({ slug: baseSource.festivalSlug, produce: async (archived) => {
  const source = baseSource;
  const fetched = await fetchSource(source, { maxAttempts: 1, fetchImpl: async url => {
    assert.ok(url === source.url || url === RFP_STOCK, "unexpected source request");
    return new Response(url === source.url ? archived ? home.replaceAll("2027", "2026") : home : stock,
      { headers: { "content-type": url === RFP_STOCK ? "application/json" : "text/html" } });
  } });
  assert.equal(fetched.attempts, 2);
  return extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T14:10:00Z");
} });
