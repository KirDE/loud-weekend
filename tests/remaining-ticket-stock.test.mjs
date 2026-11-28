import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  observeTicketSupplement,
  ticketSupplementUrl,
  TICKET_SUPPLEMENT,
} from "../lib/ingestion/ticket-supplements.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";

for (const [slug, url, primaryPath, strategy, providerId, replacement, dates] of [
  [
    "pinkpop",
    "https://www.pinkpop.nl/",
    "official-markup/pinkpop-lineup-2027.html",
    "official_markup",
    "1884453946",
    "1334453947",
    { startDate: "2027-06-18", endDate: "2027-06-20" },
  ],
  [
    "eurockeennes",
    "https://www.eurockeennes.fr/",
    "ticket-status/eurockeennes-primary.html",
    "html_fallback",
    "91a253ee-12da-4261-ba09-4270b6d7108c",
    "cd7b45e9-6dd8-4c72-a146-983b4b82ae7f",
    { startDate: "2027-07-02", endDate: "2027-07-05" },
  ],
]) {
  const source = parserSource(slug, { url, strategies: [strategy] });
  const stockUrl = ticketSupplementUrl(source);
  const stock = readFileSync(
    new URL(`./fixtures/ticket-status/${slug}-ordinary-stock.html`, import.meta.url),
    "utf8",
  );
  const primary = readFileSync(new URL(`./fixtures/${primaryPath}`, import.meta.url), "utf8");
  const observe = (html, proof = dates) => observeTicketSupplement(html, source, stockUrl, proof);
  const extract = (body, html) =>
    extractFestivalCandidate(
      JSON.stringify({ kind: TICKET_SUPPLEMENT, body, ticket: { url: stockUrl, html } }),
      source,
      "2026-11-22T12:25:00Z",
    );

  test(`${slug}: reads changed provider IDs and price from the current source`, () => {
    const changed = stock
      .replaceAll(providerId, replacement)
      .replace(slug === "pinkpop" ? "€ 315" : "219€", slug === "pinkpop" ? "€ 267" : "267€");
    const candidate = extract(primary, changed);
    assert.equal(candidate.ticketStatus, "available", candidate.warnings.join("; "));
    assert.equal(candidate.ticketsUrl, stockUrl);
    const proof = candidate.evidence.find((item) => item.field === "ticketStatus");
    assert.equal(proof.sourceUrl, stockUrl);
    assert.ok(proof.excerpt.includes(replacement));
    assert.ok(proof.excerpt.includes("267"));
    assert.ok(!proof.excerpt.includes(providerId));
  });

  for (const [label, change] of [
    ["prior edition", (html) => html.replaceAll("2027", "2026")],
    ["block page", () => "<html><title>Access denied</title></html>"],
    [
      "hidden controls",
      (html) =>
        html.replace("<body>", "<body><section hidden>").replace("</body>", "</section></body>"),
    ],
    [
      "disabled controls",
      (html) =>
        html
          .replace("<body>", "<body><section aria-disabled='true'>")
          .replace("</body>", "</section></body>"),
    ],
    [
      "missing provider",
      (html) =>
        html.replaceAll(/(?:www\.ticketmaster\.nl|widget\.weezevent\.com)/g, "foreign.test"),
    ],
    [
      "sold out",
      (html) =>
        slug === "pinkpop"
          ? html.replace("Regulier</h3>", "Regulier</h3><span>Uitverkocht</span>")
          : html.replace("Disponible<br/>", "Épuisé Disponible<br/>"),
    ],
  ])
    test(`${slug}: ${label} never establishes availability`, () => {
      const observation = observe(change(stock));
      assert.equal(observation.status, undefined);
      assert.ok(observation.warning);
    });

  test(`${slug}: missing primary dates cannot be supplied by the secondary stock document`, () => {
    const candidate = extract("<html></html>", stock);
    assert.equal(candidate.ticketSupplement, undefined);
    assert.equal(candidate.ticketStatus, undefined);
    assert.ok(
      candidate.warnings.some((warning) =>
        warning.includes("current organizer edition dates absent"),
      ),
    );
  });

  test(`${slug}: only the registered organizer endpoint may produce the supplement`, () => {
    assert.equal(
      observeTicketSupplement(stock, source, "https://foreign.test/tickets", dates).status,
      undefined,
    );
    for (const change of [
      { url: "https://foreign.test/" },
      { fetchUrl: url },
      { strategies: ["manual_review"] },
    ]) {
      assert.equal(ticketSupplementUrl({ ...source, ...change }), undefined);
    }
  });

  if (slug === "eurockeennes")
    test("Eurockéennes rejects different date ranges within the same year", () => {
      assert.equal(observe(stock.replace("2, 3, 4 et 5", "3, 4, 5 et 6")).status, undefined);
    });
}

test("Pinkpop weekend benefits may include an extra opening show without losing stock evidence", () => {
  const source = parserSource("pinkpop", { url: "https://www.pinkpop.nl/" });
  const stock = readFileSync(
    new URL("./fixtures/ticket-status/pinkpop-ordinary-stock.html", import.meta.url),
    "utf8",
  );
  const observe = (summary) =>
    observeTicketSupplement(
      stock.replace("Toegang tot het festivalterrein en de Festivalcamping", summary),
      source,
      ticketSupplementUrl(source),
      { startDate: "2027-06-18", endDate: "2027-06-20" },
    );
  assert.equal(
    observe(
      "Toegang tot het festivalterrein (incl. openingsshow op donderdag 17 juni) en festivalcamping",
    ).status,
    "available",
  );
  for (const summary of [
    "Alleen festivalcamping",
    "Toegang tot het festivalterrein",
    "Toegang tot het festivalterrein (incl. uitverkocht) en festivalcamping",
    "Geen toegang tot het festivalterrein en de Festivalcamping",
  ])
    assert.equal(observe(summary).status, undefined);
});
