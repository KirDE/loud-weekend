import { mock, after } from "node:test";
mock.method(Date, "now", () => Date.parse("2026-11-22T14:30:00Z"));
after(() => mock.restoreAll());
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { provinssiStockResponse } from "./support/provinssi-stock-fixture.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
const baseSource = parserSource("provinssi", { url: "https://www.provinssi.fi/en/" }),
  home = readFileSync(
    new URL("./fixtures/official-markup/provinssi-excerpt.html", import.meta.url),
    "utf8",
  );
ticketProducerPublication({
  slug: baseSource.festivalSlug,
  exerciseAnnouncementAddition: true,
  produce: async (archived) => {
    const source = baseSource;
    const r = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (url) => {
        if (url === source.url)
          return new Response(archived ? home.replaceAll("2027", "2026") : home);
        const r = provinssiStockResponse(url);
        assert.ok(r);
        return r;
      },
    });
    assert.equal(r.attempts, 3);
    return extractFestivalCandidate(await r.response.text(), source, "2026-11-22T14:30:00Z");
  },
  forbiddenCandidates: (c) =>
    ["scope", "marker", "artist", "date"].map((mode) => {
      const d = structuredClone(c);
      if (mode === "scope") d.ticketSupplement!.scope!.namespace = "foreign";
      if (mode === "marker") delete d.ticketSupplement;
      if (mode === "artist") {
        d.lineup!.push("Synthetic Unapproved Addition");
        d.evidence = d.evidence.filter((e) => e.field !== "lineup");
      }
      if (mode === "date") d.startDate = "2027-06-24";
      d.warnings.push("Synthetic upstream review must not bypass canonical gate");
      return d;
    }),
  refusalPattern: /matching persisted official|Provinssi publication/,
});
