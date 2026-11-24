import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
const source = {
  festivalSlug: "masters-of-rock",
  url: "https://www.mastersofrock.cz/",
  editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"] as const,
  enabled: true,
  refreshPolicy: "every_3_days" as const,
};
ticketProducerPublication({
  slug: source.festivalSlug,
  produce: async (archived) => {
    let html = await readFile(
      new URL("./fixtures/masters-of-rock-2027-home.html", import.meta.url),
      "utf8",
    );
    // Generic Event stock intentionally disagrees with the verified scoped card.
    const anchor = html.match(/<a href="\/cs\/koncerty\/2027-masters-of-rock"[^]*?<\/a>/)![0];
    html = html.replace("Na stání</h3>", "Na stání vyprodáno</h3>").replace(anchor, "");
    html +=
      '<script type="application/ld+json">' +
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Masters of Rock 2027",
        startDate: "2027-07-08",
        endDate: "2027-07-11",
        offers: { "@type": "Offer", availability: "https://schema.org/InStock", url: source.url },
      }) +
      "</script>";
    if (archived) html = html.replaceAll("2027", "2026");
    const fetched = await fetchSource(
      { ...source, strategies: [...source.strategies] },
      {
        maxAttempts: 1,
        fetchImpl: async (target) => {
          assert.equal(String(target), source.url);
          return new Response(html, { headers: { "content-type": "text/html" } });
        },
      },
    );
    const candidate = extractFestivalCandidate(
      await fetched.response.text(),
      { ...source, strategies: [...source.strategies] },
      "2026-11-22T11:32:00Z",
    );
    if (!archived) assert.equal(candidate.ticketStatus, "sold_out");
    return candidate;
  },
});
