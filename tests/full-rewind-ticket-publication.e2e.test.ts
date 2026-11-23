import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
import { FULL_REWIND_HOME, FULL_REWIND_BANDS } from "../lib/ingestion/adapters/full-rewind.ts";
const source = parserSource("full-rewind", { url: FULL_REWIND_HOME });
const fixture = (name: string) => readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
ticketProducerPublication({
  slug: source.festivalSlug,
  produce: async (archived) => {
    const productUrl = "https://full-rewind.de/products/full-rewind-weekend-ticket-2027.js";
    const pages = new Map([
      [source.url, await fixture("full-rewind-home-excerpt.html")],
      [FULL_REWIND_BANDS, await fixture("full-rewind-bands-excerpt.html")],
      [productUrl, await fixture("ticket-status/full-rewind-weekend.json")],
    ]);
    if (archived) for (const [url, html] of pages) pages.set(url, html.replaceAll("2027", "2026"));
    const fetched = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) => {
        assert.ok(pages.has(String(target)), "unexpected source request: " + target);
        return new Response(pages.get(String(target)), {
          headers: {
            "content-type": String(target).endsWith(".js") ? "text/javascript" : "text/html",
          },
        });
      },
    });
    assert.equal(fetched.response.status, 200);
    return extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T11:32:00Z");
  },
});
