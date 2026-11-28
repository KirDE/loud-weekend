import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataQualityContent } from "../components/DataQualityContent.tsx";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { summarizeDataQuality } from "../lib/catalog/data-quality.ts";

const copy = {
  en: {
    empty: "No current editions are available.",
    unavailable: "Catalogue data is temporarily unavailable.",
    link: "Browse festivals and official links",
    stale: "Check overdue, failed or source retired",
    noCheck: "No current successful check to display.",
  },
  de: {
    empty: "Keine aktuellen Ausgaben vorhanden.",
    unavailable: "Katalogdaten sind vorübergehend nicht verfügbar.",
    link: "Festivals und offizielle Links ansehen",
    stale: "Prüfung überfällig, fehlgeschlagen oder Quelle eingestellt",
    noCheck: "Keine aktuelle erfolgreiche Prüfung vorhanden.",
  },
  ru: {
    empty: "Нет текущих выпусков.",
    unavailable: "Каталог временно недоступен.",
    link: "Фестивали и официальные ссылки",
    stale: "Проверка просрочена, не удалась или источник отключён",
    noCheck: "Нет актуальной успешной проверки для отображения.",
  },
};

const empty = summarizeDataQuality({ festivals: [], editions: [] });
const stale = summarizeDataQuality(
  {
    festivals: [
      {
        lineup: [],
        headliners: [],
        ticketStatus: "unknown",
        freshness: {
          sourceCheckStale: true,
          lastSuccessfulSourceCheckAt: "2026-11-21T00:00:00Z",
        },
      },
    ],
    editions: [],
  },
  Date.parse("2026-11-23T00:00:00Z"),
);

function render(language, data) {
  return renderToStaticMarkup(
    createElement(
      LanguageProvider,
      { initialLanguage: language },
      createElement(DataQualityContent, { data }),
    ),
  );
}

for (const [lang, t] of Object.entries(copy)) {
  const link = new RegExp(`<a[^>]*href="/${lang}/?"[^>]*>${t.link}</a>`);
  test(`${lang}: unavailable catalogue is announced without publishing empty or zero coverage`, () => {
    const html = render(lang, undefined);
    assert.ok(html.includes(`<p role="status">${t.unavailable}`));
    assert.ok(!html.includes(t.empty));
    assert.doesNotMatch(html, /<dl>|<time\b/);
    assert.match(html, link);
  });

  test(`${lang}: an empty catalogue is distinct from a read failure`, () => {
    const html = render(lang, empty);
    assert.ok(html.includes(`<p>${t.empty}</p>`));
    assert.ok(!html.includes(t.unavailable));
    assert.doesNotMatch(html, /role="status"|<dl>|<time\b/);
    assert.match(html, link);
  });

  test(`${lang}: a stale successful check does not get a recent-check timestamp`, () => {
    const html = render(lang, stale);
    assert.ok(html.includes(`<dt>${t.stale}</dt><dd>1 / 1</dd>`));
    assert.ok(html.includes(`<p>${t.noCheck}</p>`));
    assert.doesNotMatch(html, /<time\b|2026-11-21/);
  });
}
