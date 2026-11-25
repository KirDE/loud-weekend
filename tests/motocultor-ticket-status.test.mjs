import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "cheerio";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import {
  observeTicketSupplement,
  ticketSupplementUrl,
} from "../lib/ingestion/ticket-supplements.ts";
const source = {
  festivalSlug: "motocultor",
  url: "https://www.motocultor-festival.com/actualites/",
  editionYear: 2027,
  strategies: ["official_markup"],
  enabled: true,
  refreshPolicy: "daily",
};
const ticketUrl = ticketSupplementUrl(source);
const fixture = readFileSync(
  new URL("./fixtures/ticket-status/motocultor-regular-pass.html", import.meta.url),
  "utf8",
);
const news = readFileSync(
  new URL("./fixtures/official-markup/motocultor-astro-news.html", import.meta.url),
  "utf8",
);
const article = readFileSync(
  new URL("./fixtures/official-markup/motocultor-astro-new-names.html", import.meta.url),
  "utf8",
);
const alter = (fn) => {
  const $ = load(fixture);
  fn($);
  return $.html();
};
const ordinary = ($) =>
  $(".passes__list > .pass > .ticket").filter((_, e) => $(e).find("h3").text() === "Pass 4 jours");
const observe = (html) => observeTicketSupplement(html, source, ticketUrl);
test("Motocultor: regular four-day pass remains available despite sold-out early birds", () => {
  assert.equal(observe(fixture).status, "available");
  assert.equal(observe(fixture).warning, undefined);
  assert.equal(observe(fixture.replaceAll("239", "249")).status, "available");
});
for (const [name, html] of [
  ["archived page", fixture.replaceAll("2027", "2026")],
  [
    "archived product under current page",
    alter(($) =>
      ordinary($)
        .find(".ticket__year,.ticket__dates")
        .each((_, e) => $(e).text($(e).text().replaceAll("2027", "2026"))),
    ),
  ],
  ["missing edition stub", alter(($) => ordinary($).find(".ticket__stub").remove())],
  ["wrong canonical", alter(($) => $("link").attr("href", "https://foreign.example.test/"))],
  ["hidden pass", alter(($) => ordinary($).attr("hidden", ""))],
  ["hidden tier", alter(($) => ordinary($).find(".tier--on-sale").attr("aria-hidden", "true"))],
  [
    "disabled control",
    alter(($) => ordinary($).find(".ticket__cta").attr("aria-disabled", "true")),
  ],
  ["disabled ancestor", alter(($) => ordinary($).attr("class", "ticket disabled"))],
  ["foreign vendor", fixture.replaceAll("https://feverup.com", "https://foreign.example.test")],
  ["wrong vendor path", fixture.replaceAll("/m/706920", "/parking/706920")],
  [
    "duplicate ordinary pass",
    alter(($) => ordinary($).parent().after(ordinary($).parent().clone())),
  ],
  [
    "duplicated regular tier",
    alter(($) =>
      ordinary($).find(".tier--on-sale").after(ordinary($).find(".tier--on-sale").clone()),
    ),
  ],
  [
    "contradictory regular tier",
    alter(($) => ordinary($).find(".tier--on-sale").addClass("tier--sold-out")),
  ],
  [
    "regular sold out while day inventory unknown",
    alter(($) => {
      ordinary($)
        .find(".tier--on-sale")
        .removeClass("tier--on-sale")
        .find(".tier__state")
        .text("Épuisé");
      ordinary($).find(".ticket__cta").remove();
    }),
  ],
  ["only early bird remains", alter(($) => ordinary($).find(".tier--on-sale").remove())],
  [
    "only visible decoration, no inventory",
    alter(($) => ordinary($).find(".ticket__main").attr("hidden", "")),
  ],
])
  test(`Motocultor: ${name} abstains, never infers global sellout`, () => {
    const r = observe(html);
    assert.equal(r.status, undefined);
    assert.ok(r.warning);
  });
test("Motocultor: merges ticket evidence without artist or provider changes", async () => {
  const seen = [];
  const fetched = await fetchSource(source, {
    maxAttempts: 1,
    fetchImpl: async (target) => {
      seen.push(String(target));
      const body =
        String(target) === source.url ? news : String(target) === ticketUrl ? fixture : article;
      const response = new Response(body, { headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: String(target) });
      return response;
    },
  });
  assert.equal(seen.length, 3);
  assert.equal(seen[2], ticketUrl);
  const c = extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T10:48:00Z");
  assert.equal(c.lineup.length, 17);
  assert.equal(c.ticketStatus, "available");
  assert.equal(c.ticketsUrl, ticketUrl);
  assert.deepEqual(c.warnings, []);
  assert.ok(
    c.evidence
      .filter((e) => ["ticketStatus", "ticketsUrl"].includes(e.field))
      .every((e) => e.sourceUrl === ticketUrl),
  );
  const current = {
    slug: "motocultor",
    editionYear: 2027,
    status: "partial",
    headliners: [],
    lineup: c.lineup,
    ticketStatus: "unknown",
  };
  const value = evaluateCandidate(current, c);
  assert.equal(value.publishable, true, JSON.stringify(value.reviewReasons));
  assert.ok(value.changes.every((c) => ["ticketStatus", "ticketsUrl"].includes(c.field)));
  assert.deepEqual(
    evaluateCandidate({ ...current, ticketStatus: "available", ticketsUrl: ticketUrl }, c).changes,
    [],
  );
});
for (const selector of [
  ".tier--on-sale",
  ".tiers",
  ".tier--on-sale .tier__state",
  ".tier--on-sale .tier__price",
]) {
  test(`Motocultor: disabled ${selector} cannot publish regular availability`, async () => {
    const disabled = alter(($) => ordinary($).find(selector).attr("aria-disabled", "true"));
    assert.equal(observe(disabled).status, undefined);
    const fetched = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) => {
        const url = String(target);
        const response = new Response(
          url === source.url ? news : url === ticketUrl ? disabled : article,
          {
            headers: { "content-type": "text/html" },
          },
        );
        Object.defineProperty(response, "url", { value: url });
        return response;
      },
    });
    const candidate = extractFestivalCandidate(
      await fetched.response.text(),
      source,
      "2026-11-22T10:48:00Z",
    );
    const result = evaluateCandidate(
      {
        slug: source.festivalSlug,
        editionYear: 2027,
        status: "partial",
        headliners: [],
        lineup: candidate.lineup,
        ticketStatus: "unknown",
      },
      candidate,
    );
    assert.equal(candidate.ticketStatus, undefined);
    assert.ok(!result.changes.some(({ field }) => ["ticketStatus", "ticketsUrl"].includes(field)));
  });
}
test("Motocultor: discovered article redirects fail source identity rather than blessing foreign content", async () => {
  await assert.rejects(
    fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) => {
        const response = new Response(String(target) === source.url ? news : article, {
          headers: { "content-type": "text/html" },
        });
        Object.defineProperty(response, "url", {
          value:
            String(target) === source.url ? source.url : "https://foreign.example.test/article/",
        });
        return response;
      },
    }),
    /discovered official identity/,
  );
});
test("Motocultor: failure of current ticket page retains source failure rather than stale sale prose", async () => {
  const r = await fetchSource(source, {
    maxAttempts: 1,
    fetchImpl: async (target) =>
      new Response(String(target) === source.url ? news : article, {
        status: String(target) === ticketUrl ? 403 : 200,
        headers: { "content-type": "text/html" },
      }),
  });
  assert.equal(r.response.status, 403);
  assert.equal(r.attempts, 3);
});
