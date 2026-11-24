import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";

ticketProducerPublication({
  slug: "idays",
  produce: async (archived) => {
    const year = archived ? 2026 : 2027;
    const source = parserSource("idays", {
      url: "https://www.idays.it/",
      editionYear: year,
      strategies: ["json_ld_event", "html_fallback"],
    });
    const home = (
      await readFile(new URL("./fixtures/idays/home-noah-2027.html", import.meta.url), "utf8")
    ).replaceAll("2027", String(year));
    const tickets = (
      await readFile(new URL("./fixtures/idays/tickets-2027.html", import.meta.url), "utf8")
    ).replaceAll("2027", String(year));
    const calls: string[] = [];
    const fetched = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) => {
        const url = String(target);
        calls.push(url);
        assert.ok(
          [source.url, "https://www.idays.it/tickets"].includes(url),
          "unexpected source request: " + url,
        );
        return new Response(url === source.url ? home : tickets, {
          headers: { "content-type": "text/html" },
        });
      },
    });
    assert.equal(fetched.response.status, 200);
    assert.deepEqual(calls, [source.url, "https://www.idays.it/tickets"]);
    return extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T12:55:00Z");
  },
});
