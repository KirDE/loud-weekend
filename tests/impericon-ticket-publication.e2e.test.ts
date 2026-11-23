import assert from "node:assert/strict";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import {
  impericonFixture,
  impericonCurrentSource as source,
  impericonTicketUrl,
  impericonTicketFixture,
} from "./support/impericon-current.ts";

ticketProducerPublication({
  slug: source.festivalSlug,
  produce: async (archived) => {
    const fixture = impericonFixture();
    const pages = new Map([
      [source.url, fixture.home],
      ...fixture.articles.map((a) => [a.url, a.html] as [string, string]),
      [impericonTicketUrl, impericonTicketFixture],
    ]);
    // Keep the requested current source but supply a stale edition. No live GETs.
    if (archived)
      for (const [url, body] of [...pages]) {
        pages.delete(url);
        pages.set(url.replaceAll("2027", "2026"), body.replaceAll("2027", "2026"));
      }
    const observedSource = archived ? { ...source, editionYear: 2026 } : source;
    const fetched = await fetchSource(observedSource, {
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
    return extractFestivalCandidate(
      await fetched.response.text(),
      observedSource,
      "2026-11-22T12:40:00Z",
    );
  },
});
