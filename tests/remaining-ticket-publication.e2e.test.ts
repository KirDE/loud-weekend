import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { ticketSupplementUrl } from "../lib/ingestion/ticket-supplements.ts";
import { parserSource } from "./support/parser-source.ts";

const fixture = (name: string) => readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
for (const [slug, url, primary, strategy] of [
  ["pinkpop", "https://www.pinkpop.nl/", "official-markup/pinkpop-lineup-2027.html", "official_markup"],
  ["eurockeennes", "https://www.eurockeennes.fr/", "ticket-status/eurockeennes-primary.html", "html_fallback"],
] as const) {
  const source = parserSource(slug, { url, strategies: [strategy] });
  ticketProducerPublication({ slug, produce: async (archived) => {
    const pages = new Map([
      [url, await fixture(primary)],
      [ticketSupplementUrl(source)!, await fixture(`ticket-status/${slug}-ordinary-stock.html`)],
    ]);
    const fetched = await fetchSource(source, { maxAttempts: 1, fetchImpl: async target => {
      const page = pages.get(String(target));
      assert.ok(page, "unexpected source request: " + target);
      return new Response(archived ? page.replaceAll("2027", "2026") : page, { headers: { "content-type": "text/html" } });
    } });
    assert.equal(fetched.response.status, 200);
    return extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T12:30:00Z");
  } });
}
