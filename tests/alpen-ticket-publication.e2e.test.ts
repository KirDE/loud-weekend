import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { alpenAnnouncements } from "../lib/ingestion/adapters/alpen-flair.ts";
const source = { festivalSlug: "alpen-flair", url: "https://www.alpen-flair.com/", editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"] as const, enabled: true, refreshPolicy: "every_3_days" as const };
ticketProducerPublication({ slug: source.festivalSlug, produce: async archived => {
  let home = await readFile(new URL("./fixtures/alpen-flair/home.html", import.meta.url), "utf8");
  let article = await readFile(new URL("./fixtures/alpen-flair/article.html", import.meta.url), "utf8");
  const articleUrls = alpenAnnouncements(home, 2027);
  if (archived) { home = home.replaceAll("2027", "2026"); article = article.replaceAll("2027", "2026"); }
  // An archived homepage has no eligible current announcement; the normal
  // producer may therefore retain review/no-stock before fetching an article.
  const fetched = await fetchSource({ ...source, strategies: [...source.strategies] }, { maxAttempts: 1, fetchImpl: async target => {
    assert.ok([source.url, ...articleUrls].includes(String(target)));
    return new Response(String(target) === source.url ? home : article, { headers: { "content-type": "text/html" } });
  } });
  return extractFestivalCandidate(await fetched.response.text(), { ...source, strategies: [...source.strategies] }, "2026-11-22T11:32:00Z");
} });
