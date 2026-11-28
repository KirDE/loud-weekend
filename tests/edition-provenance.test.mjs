import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalEditionContent } from "../components/PublicCatalogPages.tsx";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { LocalPlannerProvider } from "../components/LocalPlanner.tsx";
import { festival } from "./support/catalog.ts";

const fields = ["ticketStatus", "ticketsUrl", "startDate", "constructor", "futureField"];
const checkedAt = "2026-11-02T13:30:00.000Z";
const item = {
  ...festival,
  recordState: "current",
  completeness: "partial",
  provenance: fields.map((field, index) => ({
    field,
    url: "https://organizer.example/ticket-evidence/" + index,
    note: "Reviewed excerpt " + index,
    checkedAt,
  })),
};

for (const [language, locale, checked, labels] of [
  ["en", "en-US", "checked", ["ticket availability", "ticket link", "dates", "source detail"]],
  ["de", "de-DE", "geprüft", ["Ticketverfügbarkeit", "Ticketlink", "Termine", "Quellenhinweis"]],
  [
    "ru",
    "ru-RU",
    "проверено",
    ["наличие билетов", "ссылка на билеты", "даты", "сведения источника"],
  ],
]) {
  test(
    "edition provenance keeps localized labels and the original source evidence in " + language,
    () => {
      const html = renderToStaticMarkup(
        h(
          LanguageProvider,
          { initialLanguage: language },
          h(LocalPlannerProvider, null, h(FestivalEditionContent, { item, artistSlugs: {} })),
        ),
      );
      const provenance = html.match(/<section class="sourceNote">.*?<\/section>/s)?.[0];
      assert.ok(provenance);
      const rows = [...provenance.matchAll(/<p>(<b>.*?<\/p>)/g)].map((row) => row[1]);
      const formattedDate = new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(checkedAt));
      assert.equal(rows.length, fields.length);
      rows.forEach((row, index) => {
        assert.ok(row.startsWith(`<b>${labels[Math.min(index, 3)]}:</b>`), row);
        assert.ok(row.includes(`href="${item.provenance[index].url}"`), row);
        assert.ok(row.includes(item.provenance[index].note), row);
        assert.ok(row.includes(`<small>${checked} ${formattedDate}</small>`), row);
      });
    },
  );
}
