import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
const source = parserSource("copenhell", { url: "https://copenhell.dk/faith-no-more-headline-copenhell-2027/" });
const fixture = (name: string) => readFile(new URL("./fixtures/"+name, import.meta.url), "utf8");
ticketProducerPublication({ slug: source.festivalSlug, produce: async archived => {
  const data = JSON.parse(await fixture("official-markup/copenhell-current-2027.json"));
  const pages = new Map<string, string>(data.documents.map((d: { url: string; html: string }) => [d.url, d.html]));
  if (archived) for (const [url, html] of pages) pages.set(url, html.replaceAll("2027", "2026"));
  const fetched = await fetchSource(source, { maxAttempts: 1, fetchImpl: async target => {
    assert.ok(pages.has(String(target)), "unexpected source request: "+target);
    return new Response(pages.get(String(target)), { headers: { "content-type": "text/html" } });
  } });
  assert.equal(fetched.response.status, 200);
  return extractFestivalCandidate(await fetched.response.text(), source, "2026-11-22T11:32:00Z");
} });
