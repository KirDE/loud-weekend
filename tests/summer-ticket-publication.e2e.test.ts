import { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { summerStockResponse } from "./support/summer-stock-fixture.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
before(() => mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-22T14:18:00Z") }));
after(() => mock.timers.reset());

const baseSource = parserSource("summer-punch", { url: "https://summerpunchfestival.pl/" });
const home = readFileSync(
  new URL("./fixtures/official-markup/summer-punch-full.html", import.meta.url),
  "utf8",
);
ticketProducerPublication({
  slug: baseSource.festivalSlug,
  produce: async (archived) => {
    const source = baseSource;
    const fetched = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (url) => {
        if (url !== source.url) {
          const r = summerStockResponse(url);
          assert.ok(r, "unexpected stock request");
          return r;
        }
        const r = new Response(archived ? home.replaceAll("2027", "2026") : home);
        Object.defineProperty(r, "url", { value: source.url });
        return r;
      },
    });
    assert.equal(fetched.attempts, 6);
    return extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T14:18:00Z");
  },
  forbiddenCandidates: (candidate) => {
    const cases = [
      undefined,
      { namespace: "foreign-event", productId: "140247054:140247050" },
      { namespace: "602356450160803841", productId: "VIP" },
    ].map((scope) => {
      const c = structuredClone(candidate);
      c.ticketSupplement!.scope = scope;
      return c;
    });
    const stripped = structuredClone(candidate);
    delete stripped.ticketSupplement;
    cases.push(stripped);
    return cases.map((c) => ({
      ...c,
      warnings: [
        ...c.warnings,
        "Synthetic upstream scope review requiring independent canonical refusal",
      ],
    }));
  },
  refusalPattern: /matching persisted official ticket evidence/,
});
