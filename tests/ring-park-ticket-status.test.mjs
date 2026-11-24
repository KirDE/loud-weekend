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

for (const slug of ["rock-am-ring", "rock-im-park"]) {
  const source = {
    festivalSlug: slug,
    url: `https://www.${slug}.com/`,
    editionYear: 2027,
    strategies: ["official_markup"],
    enabled: true,
    refreshPolicy: "daily",
  };
  const url = ticketSupplementUrl(source);
  const fixture = readFileSync(
    new URL(`./fixtures/ticket-status/${slug}-regular-admission.html`, import.meta.url),
    "utf8",
  );
  const observe = (html) => observeTicketSupplement(html, source, url);
  const alter = (fn) => {
    const $ = load(fixture);
    fn($);
    return $.html();
  };
  const ordinary = ($) =>
    $("h2")
      .filter((_, e) => $(e).text() === "Festival tickets")
      .parent()
      .children(".ticketitem-block");
  test(`${slug}: actual ticket structure proves ordinary admission, not sold-out parking`, () => {
    assert.equal(observe(fixture).status, "available");
    assert.equal(observe(fixture).warning, undefined);
  });
  for (const [name, html] of [
    ["archived page", fixture.replaceAll("2027", "2026")],
    [
      "archived product under current page",
      alter(($) =>
        ordinary($)
          .find(".footer-content")
          .each((_, e) => $(e).text($(e).text().replaceAll("2027", "2026"))),
      ),
    ],
    ["missing canonical identity", alter(($) => $("link").remove())],
    [
      "foreign canonical",
      alter(($) => $("link").attr("href", "https://foreign.example.test/tickets")),
    ],
    ["hidden group", alter(($) => ordinary($).parent().attr("hidden", ""))],
    ["hidden controls", alter(($) => ordinary($).find("a").attr("aria-hidden", "true"))],
    ["disabled controls", alter(($) => ordinary($).find("a").attr("aria-disabled", "true"))],
    ["disabled ancestor", alter(($) => ordinary($).find(".ctas").attr("class", "ctas disabled"))],
    ["disabled card", alter(($) => ordinary($).attr("aria-disabled", "true"))],
    ["foreign seller", fixture.replaceAll("www.eventim.de", "foreign.example.test")],
    ["wrong seller path", fixture.replaceAll("/noapp/event/", "/parking/")],
    ["missing current product", alter(($) => ordinary($).first().remove())],
    [
      "duplicated ordinary product",
      alter(($) => ordinary($).first().after(ordinary($).first().clone())),
    ],
    [
      "conflicting stock and control",
      alter(($) => ordinary($).find(".header").append("<span>Sold out</span>")),
    ],
    [
      "duplicate buy control",
      alter(($) =>
        ordinary($)
          .find(".ctas")
          .each((_, e) => $(e).append($(e).find("a").clone())),
      ),
    ],
    [
      "all regular tickets sold out but bundles unknown",
      alter(($) => {
        ordinary($).find("a").remove();
        ordinary($).find(".ctas").text("Sold out");
      }),
    ],
    ["only side product remains", alter(($) => ordinary($).remove())],
  ])
    test(`${slug}: ${name} abstains and retains last verified data`, () => {
      const result = observe(html);
      assert.equal(result.status, undefined);
      assert.ok(result.warning);
    });
  test(`${slug}: fetch records secondary ticket evidence without lineup/provider changes`, async () => {
    const primary =
      '<main>4-6 June 2027 <a href="/line-up/synthetic-artist">Synthetic Artist</a></main>';
    const requests = [];
    const fetched = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) => {
        requests.push(String(target));
        assert.ok([source.url, url].includes(String(target)));
        return new Response(String(target) === url ? fixture : primary, {
          headers: { "content-type": "text/html" },
        });
      },
    });
    assert.deepEqual(requests, [source.url, url]);
    const candidate = extractFestivalCandidate(
      await fetched.response.text(),
      source,
      "2026-11-22T10:30:00Z",
    );
    assert.equal(candidate.ticketStatus, "available");
    assert.equal(candidate.ticketsUrl, url);
    assert.deepEqual(candidate.warnings, []);
    assert.ok(
      candidate.evidence
        .filter((e) => ["ticketStatus", "ticketsUrl"].includes(e.field))
        .every((e) => e.sourceUrl === url),
    );
    const current = {
      slug,
      editionYear: 2027,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      status: "partial",
      headliners: [],
      lineup: ["Synthetic Artist"],
      ticketStatus: "unknown",
    };
    const value = evaluateCandidate(current, candidate);
    assert.equal(value.publishable, true, JSON.stringify(value.reviewReasons));
    assert.ok(value.changes.every((c) => ["ticketStatus", "ticketsUrl"].includes(c.field)));
    assert.deepEqual(
      evaluateCandidate({ ...current, ticketStatus: "available", ticketsUrl: url }, candidate)
        .changes,
      [],
    );
  });
  for (const [location, notice] of [
    [".header", "<div>Sold</div><div>out</div>"],
    [".header", '<span style="display: block">Sold</span><span style="display: block">out</span>'],
    [".header", "<span>Sold<br>out</span>"],
    [".header", "<span>aus<strong>verkauft</strong></span>"],
    [".header", '<span>aus<span style="display: inline-block">verkauft</span></span>'],
    [".footer-content", "<p>This Festival Ticket is sold out.</p>"],
  ]) {
    test(`${slug}: visible stock contradiction ${notice} prevents publication`, async () => {
      const html = alter(($) => ordinary($).find(location).append(notice));
      const primary =
        '<main>4-6 June 2027 <a href="/line-up/synthetic-artist">Synthetic Artist</a></main>';
      const fetched = await fetchSource(source, {
        maxAttempts: 1,
        fetchImpl: async (target) =>
          new Response(String(target) === url ? html : primary, {
            headers: { "content-type": "text/html" },
          }),
      });
      const candidate = extractFestivalCandidate(
        await fetched.response.text(),
        source,
        "2026-11-22T10:30:00Z",
      );
      assert.equal(candidate.ticketStatus, undefined);
      const result = evaluateCandidate(
        {
          slug,
          editionYear: 2027,
          startDate: candidate.startDate,
          endDate: candidate.endDate,
          status: "partial",
          headliners: [],
          lineup: ["Synthetic Artist"],
          ticketStatus: "unknown",
        },
        candidate,
      );
      assert.ok(
        !result.changes.some(({ field }) => ["ticketStatus", "ticketsUrl"].includes(field)),
      );
    });
  }
  if (slug === "rock-im-park")
    test("Rock im Park: available ordinary admission beats sold-out other admission", () => {
      assert.equal(
        observe(
          alter(($) => {
            ordinary($).first().find("a").remove();
            ordinary($).first().find(".ctas").text("Sold out");
          }),
        ).status,
        "available",
      );
    });
  test(`${slug}: transport failures are errors, never a successful empty observation`, async () => {
    const failed = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) =>
        new Response(String(target) === source.url ? "<html></html>" : "blocked", {
          status: String(target) === source.url ? 200 : 403,
          headers: { "content-type": "text/html" },
        }),
    });
    assert.equal(failed.response.status, 403);
    assert.equal(failed.attempts, 2);
  });
}
