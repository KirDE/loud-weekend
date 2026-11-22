import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
const source = { festivalSlug: "mystic", url: "https://www.mysticfestival.pl/", editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"] as const, enabled: true, refreshPolicy: "every_3_days" as const };
ticketProducerPublication({ slug: source.festivalSlug, produce: async archived => {
  let html = await readFile(new URL("./fixtures/mystic-2027-home.html", import.meta.url), "utf8");
  if (archived) html = html.replaceAll("2027", "2026");
  const fetched = await fetchSource({ ...source, strategies: [...source.strategies] }, { maxAttempts: 1, fetchImpl: async target => {
    assert.equal(String(target), source.url);
    return new Response(html, { headers: { "content-type": "text/html" } });
  } });
  return extractFestivalCandidate(await fetched.response.text(), { ...source, strategies: [...source.strategies] }, "2026-11-22T11:32:00Z");
} });
