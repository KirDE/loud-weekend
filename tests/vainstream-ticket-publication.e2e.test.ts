import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { VAINSTREAM_STOCK } from "../lib/ingestion/vainstream-ticket-stock.ts";
import { parserSource } from "./support/parser-source.ts";
const fixture = (name: string) => readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
const baseSource = parserSource("vainstream", { url: "https://vainstream.com/artists/" });
ticketProducerPublication({
  slug: "vainstream",
  produce: async (archived) => {
    const source = baseSource;
    const pages = new Map([
      [source.url, await fixture("official-markup/vainstream-excerpt.html")],
      [VAINSTREAM_STOCK, await fixture("ticket-status/vainstream-regular-stock.html")],
    ]);
    if (archived) for (const [u, body] of pages) pages.set(u, body.replaceAll("2027", "2026"));
    const result = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) => {
        assert.ok(pages.has(String(target)));
        return new Response(pages.get(String(target)), {
          headers: { "content-type": "text/html" },
        });
      },
    });
    return extractFestivalCandidate(await result.response.text(), source, "2026-11-22T13:10:00Z");
  },
});
