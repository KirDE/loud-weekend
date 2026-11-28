import assert from "node:assert/strict";
import test from "node:test";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title";
import { renderToStaticMarkup } from "react-dom/server";
import { StageTimetable } from "../components/StageTimetable";
import { ArtistDetail } from "../components/ArtistDetail";
import { artist } from "./support/catalog";
import { FestivalExplorer } from "../components/FestivalExplorer";
import { FestivalDetail } from "../components/FestivalDetail";
import { HomeContent } from "../components/HomeContent";
import { LanguageProvider, translate, type Language } from "../components/LanguageProvider";
import { LocalPlannerProvider } from "../components/LocalPlanner";
import { festival } from "./support/catalog";
import { hasAvailableTickets } from "../lib/tickets";
import { festivalSetlistHistoryUrl } from "../lib/setlist-history";
import { homeMetadata } from "../lib/home-metadata";

const similar = { ...festival, slug: "similar-fest", name: "Similar Fest" };

for (const language of ["en", "de", "ru"] as const) {
  test(`live history links to all festival editions, not a future-year search, in ${language}`, () => {
    for (const year of [2026, 2027, 2028]) {
      const item = {
        ...festival,
        slug: "wacken-open-air",
        name: "Wacken Open Air",
        editionYear: year,
        startDate: `${year}-07-28`,
      };
      const before = structuredClone(item);
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
      assert.match(
        html,
        new RegExp(
          '<a href="https:\\/\\/www\\.setlist\\.fm\\/festivals\\/wacken-open-' +
            'air-bd6bd66\\.html" target="_blank" rel="noreferrer">',
          "",
        ),
      );
      assert.ok(html.includes(translate(language, "liveHistory")));
      assert.doesNotMatch(html, /setlist\.fm\/search|date%3A|festival%3A/);
      assert.deepEqual(item, before);
    }
  });

  test(`a new festival without a verified history page has no invented setlist.fm URL in ${language}`, () => {
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <LocalPlannerProvider>
          <FestivalDetail item={festival} festivals={[festival]} artistSlugs={{}} />
        </LocalPlannerProvider>
      </LanguageProvider>,
    );
    assert.ok(
      html.includes(
        `<small>${translate(language, "liveHistory")}</small><strong>${translate(language, "unavailable")}</strong>`,
      ),
    );
    assert.doesNotMatch(html, /href="https:\/\/www\.setlist\.fm\//);
  });
}

for (const language of ["en", "de", "ru"] as const) {
  const expected = {
    en: ["2026 lineup", "2027 lineup", "2028 lineup", "Lineup"],
    de: ["Line-up 2026", "Line-up 2027", "Line-up 2028", "Line-up"],
    ru: ["Лайнап 2026", "Лайнап 2027", "Лайнап 2028", "Лайнап"],
  }[language];

  test(`festival lineup heading uses the edition year or no year in ${language}`, () => {
    const cases = [2026, 2027, 2028, undefined].map((editionYear, index) => ({
      editionYear,
      heading: expected[index],
    }));
    for (const { editionYear, heading } of cases) {
      // A date alone does not identify the edition; a festival can span calendar years.
      const item = { ...festival, editionYear, startDate: "2027-12-31", endDate: "2028-01-01" };
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
      const lineup = html.split('class="lineupSection"')[1];
      assert.equal(lineup?.match(/<h2>([^<]+)<\/h2>/)?.[1], heading);
    }
  });
}

for (const language of ["en", "de", "ru"] as const) {
  test(`the festival series links only to its recorded edition in ${language}`, () => {
    const render = (editionYear?: number) => {
      const item = { ...festival, editionYear, startDate: "2028-06-10", endDate: "2028-06-12" };
      return renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
    };
    const href = `href="/${language}/festivals/${festival.slug}/2028`;
    const labels = {
      en: "Open 2028 edition",
      de: "Ausgabe 2028 öffnen",
      ru: "Открыть выпуск 2028 года",
    };
    const link = new RegExp(`${href}/?">${labels[language]}</a>`);
    assert.match(render(2028), link);
    assert.doesNotMatch(
      render(),
      new RegExp(`href="/${language}/festivals/${festival.slug}/[0-9]{4}/?"`),
    );
  });
}

test("history resolves canonical series independently of display-name aliases", () => {
  assert.equal(
    festivalSetlistHistoryUrl("hellfest"),
    "https://www.setlist.fm/festivals/hellfest-1bd6bd44.html",
  );
  assert.equal(
    festivalSetlistHistoryUrl("impericon"),
    "https://www.setlist.fm/festivals/impericon-festival-leipzig-63d6eabf.html",
  );
  assert.equal(
    festivalSetlistHistoryUrl("2000trees"),
    "https://www.setlist.fm/festivals/2000-trees-festival-63d6b6a3.html",
  );
  for (const slug of [
    "unknown-festival",
    "constructor",
    "toString",
    "__proto__",
    "https://example.test/",
  ]) {
    assert.equal(festivalSetlistHistoryUrl(slug), undefined);
  }
});

for (const language of ["en", "de", "ru"] as const) {
  for (const ticketStatus of ["available", "unavailable", "unknown"] as const) {
    test(`ticket page stays linked without changing ${ticketStatus} availability in ${language}`, () => {
      const item = {
        ...festival,
        ticketStatus,
        ticketsUrl: "https://festival.example.test/tickets/",
      };
      const before = structuredClone(item);
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
      assert.match(
        html,
        new RegExp(
          `<a href="https://festival.example.test/tickets/"[^>]*data-ticket-status="${ticketStatus}"`,
        ),
      );
      assert.ok(
        html.includes(
          translate(
            language,
            ticketStatus === "available" ? "officialTickets" : "ticketsInfo",
          ).replaceAll("&", "&amp;"),
        ),
      );
      if (ticketStatus !== "available") {
        assert.ok(
          html.includes(
            translate(
              language,
              ticketStatus === "unavailable" ? "ticketsUnavailable" : "ticketsUnknown",
            ),
          ),
        );
        assert.ok(!html.includes(translate(language, "officialTickets")));
      }
      assert.equal(hasAvailableTickets(item), ticketStatus === "available");
      assert.deepEqual(item, before);
    });
  }
}

test("missing ticket URL stays disabled for every availability state", () => {
  for (const ticketStatus of ["available", "unavailable", "unknown"] as const) {
    const item = { ...festival, ticketStatus, ticketsUrl: undefined };
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage="en">
        <LocalPlannerProvider>
          <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
        </LocalPlannerProvider>
      </LanguageProvider>,
    );
    assert.match(html, /class="disabled" data-ticket-status="(?:unknown|unavailable)"/);
    assert.equal(hasAvailableTickets(item), false);
    assert.doesNotMatch(html, /href="(?:undefined|#)"/);
  }
});
const expectations: Record<"de" | "ru", string[]> = {
  de: [
    "☆ Speichern",
    "Teilnahme wählen",
    "Dabei",
    "Vielleicht",
    "Nicht dabei",
    "Meinen Plan öffnen →",
    "REISE PLANEN",
    "Kalender &amp; Karte",
    "Bühnenplan",
    "Noch kein bestätigter Zeitplan",
    "Verwandte Festivals",
    "1 gemeinsame Künstler",
  ],
  ru: [
    "☆ Сохранить",
    "Укажите участие",
    "Пойду",
    "Возможно",
    "Не пойду",
    "Открыть мой план →",
    "ПЛАНИРОВАНИЕ ПОЕЗДКИ",
    "Календарь и карта",
    "Расписание сцен",
    "Подтверждённое расписание пока не опубликовано",
    "Связанные фестивали",
    "Общих артистов: 1",
  ],
};

for (const language of ["de", "ru"] as const) {
  test("detail renders all primary actions and trip copy in " + language, () => {
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <LocalPlannerProvider>
          <FestivalDetail
            item={festival}
            festivals={[festival, similar]}
            discoveryLineups={{
              artistSlugsByFestival: {
                [festival.slug]: ["sample-artist"],
                [similar.slug]: ["sample-artist"],
              },
              legacyFavoriteSlugs: {},
            }}
            artistSlugs={{ "Sample Artist": "sample-artist" }}
          />
        </LocalPlannerProvider>
      </LanguageProvider>,
    );
    for (const copy of expectations[language]) assert.ok(html.includes(copy), "Missing " + copy);
    for (const english of [
      "☆ Save",
      "Set attendance",
      "Going",
      "Maybe",
      "Not going",
      "Open my plan",
      "PLAN THE TRIP",
      "Calendar &amp; map",
      "Stage timetable",
      "No verified timetable",
      "Related festivals",
      "shared act",
    ]) {
      assert.ok(!html.includes(english), "Unexpected English copy: " + english);
    }
    assert.equal(
      translate(language as Language, "saved"),
      language === "de" ? "★ Gespeichert" : "★ Сохранено",
    );
    assert.ok(html.includes('href="/planner"') || html.includes('href="/planner/"'));
  });
}

const appearanceSeasonCopy = {
  en: {
    heading: "FESTIVAL APPEARANCES",
    seasonHeading: (year: number) => `${year} APPEARANCES`,
    summary: "1 European festival announced",
    seasonSummary: (year: number) => `1 European festival announced for ${year}`,
  },
  de: {
    heading: "FESTIVALAUFTRITTE",
    seasonHeading: (year: number) => `AUFTRITTE ${year}`,
    summary: "1 europäisches Festival angekündigt",
    seasonSummary: (year: number) => `1 europäisches Festival für ${year} angekündigt`,
  },
  ru: {
    heading: "ВЫСТУПЛЕНИЯ НА ФЕСТИВАЛЯХ",
    seasonHeading: (year: number) => `ВЫСТУПЛЕНИЯ В ${year}`,
    summary: "Объявлено: 1 европейский фестиваль",
    seasonSummary: (year: number) => `Объявлено на ${year} год: 1 европейский фестиваль`,
  },
};

for (const language of ["en", "de", "ru"] as const) {
  const copy = appearanceSeasonCopy[language];
  const render = (appearances: (typeof festival)[]) =>
    renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <LocalPlannerProvider>
          <ArtistDetail artist={artist} legacySlugs={{}} appearances={appearances} />
        </LocalPlannerProvider>
      </LanguageProvider>,
    );

  test(`artist copy names the verified appearance season in ${language}`, () => {
    for (const year of [2026, 2027, 2028]) {
      // Do not infer the edition from its event date.
      const html = render([{ ...festival, editionYear: year, startDate: "2027-06-01" }]);
      assert.ok(html.includes(`<p>${copy.seasonSummary(year)}</p>`));
      assert.ok(html.includes(`<div class="eyebrow">${copy.seasonHeading(year)}</div>`));
    }
  });

  test(`artist copy is season-neutral for mixed, unknown and empty appearances in ${language}`, () => {
    const known = { ...festival, editionYear: 2028 };
    const unknown = { ...festival, slug: "unknown", editionYear: undefined };
    const older = { ...festival, slug: "older", editionYear: 2026 };
    assert.ok(render([unknown]).includes(`<p>${copy.summary}</p>`));
    for (const appearances of [[known, older], [known, unknown], [unknown], []]) {
      const html = render(appearances);
      assert.ok(html.includes(`<div class="eyebrow">${copy.heading}</div>`));
      const summary = html.match(/class="artistHero"[^]*?<p>([^<]*)<\/p>/)?.[1];
      assert.ok(summary);
      assert.doesNotMatch(summary, /202[678]/);
    }
  });
}

const checkedAt = "2026-10-10T23:45:00.000Z";
const lastPublishedAt = "2026-10-12T00:05:00.000Z";
const dates = {
  en: ["October 10, 2026", "October 12, 2026"],
  de: ["10. Oktober 2026", "12. Oktober 2026"],
  ru: ["10 октября 2026 г.", "12 октября 2026 г."],
};

for (const language of ["en", "de", "ru"] as const) {
  test(`home and festival distinguish check and publication dates in ${language} (UTC)`, () => {
    const freshness = { checkedAt, lastPublishedAt, sourceCheckStale: true };
    const item = { ...festival, updatedAt: "2026-09-03T00:00:00Z", freshness };
    const wrap = (content: React.ReactNode) =>
      renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>{content}</LocalPlannerProvider>
        </LanguageProvider>,
      );
    const home = wrap(<HomeContent years={[]} festivals={[item]} freshness={freshness} />);
    const detail = wrap(<FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />);
    for (const html of [home, detail]) {
      assert.ok(html.includes(translate(language, "latestSourceCheck")));
      assert.ok(html.includes(translate(language, "latestCatalogPublication")));
      assert.ok(html.includes(`<time dateTime="${checkedAt}">${dates[language][0]}</time>`));
      assert.ok(html.includes(`<time dateTime="${lastPublishedAt}">${dates[language][1]}</time>`));
      assert.doesNotMatch(html, /2026-09-03|Last dataset review/);
    }
    assert.ok(detail.includes(translate(language, "sourceCheckStale")));

    const withoutEvidence = wrap(
      <FestivalDetail item={festival} festivals={[festival]} artistSlugs={{}} />,
    );
    assert.ok(withoutEvidence.includes(translate(language, "sourceCheckUnavailable")));
    assert.doesNotMatch(withoutEvidence, /<time /);
    assert.ok(
      wrap(<HomeContent years={[]} festivals={[festival]} freshness={{}} />).includes(
        translate(language, "sourceCheckUnavailable"),
      ),
    );
    assert.ok(
      !wrap(<FestivalExplorer festivals={[item]} />).includes(
        translate(language, "latestSourceCheck"),
      ),
    );
  });
}

for (const language of ["en", "de", "ru"] as const) {
  test(`artist appearances follow festival dates, not import order, in ${language}`, () => {
    const appearances = [
      { ...festival, slug: "unknown", startDate: undefined },
      { ...festival, slug: "late", startDate: "2027-08-01", updatedAt: "2026-01-01" },
      { ...festival, slug: "early-b", startDate: "2027-06-01", updatedAt: "2026-11-07" },
      { ...festival, slug: "early-a", startDate: "2027-06-01", updatedAt: "2026-11-06" },
    ];
    const before = structuredClone(appearances);
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <LocalPlannerProvider>
          <ArtistDetail artist={artist} legacySlugs={{}} appearances={appearances} />
        </LocalPlannerProvider>
      </LanguageProvider>,
    );
    assert.deepEqual(
      [...html.matchAll(/href="\/festivals\/([^/"\s]+)\/?"/g)].map((match) => match[1]),
      ["early-a", "early-b", "late", "unknown"],
    );
    assert.deepEqual(appearances, before);
  });
}

for (const [language, labels] of Object.entries({
  en: ["Artists reported", "Verified coverage unavailable", "Partial coverage"],
  de: ["Erfasste Künstler", "Keine verifizierten Angaben zur Abdeckung", "Teilweise Abdeckung"],
  ru: ["Указано артистов", "Подтверждённый охват неизвестен", "Частичный охват"],
} as const)) {
  test(`playlist coverage reports provider-specific stored counts and times in ${language}`, () => {
    const spotifyUrl = "https://open.spotify.com/playlist/1234567890123456789012";
    const youtubeMusicUrl = "https://music.youtube.com/playlist?list=Synthetic01";
    const spotify = { reportedArtists: 110, tracks: 220, recordedAt: "2026-11-20T12:00:00.000Z" };
    const youtubeMusic = { reportedArtists: 8, tracks: 14, recordedAt: "2026-11-18T14:00:00.000Z" };
    const render = (
      coverage?: { spotify?: typeof spotify; youtubeMusic?: typeof youtubeMusic },
      reviewedPlaylistLinks?: (typeof festival)["reviewedPlaylistLinks"],
    ) =>
      renderToStaticMarkup(
        <LanguageProvider initialLanguage={language as Language}>
          <LocalPlannerProvider>
            <FestivalDetail
              item={{ ...festival, reviewedPlaylistLinks }}
              festivals={[festival]}
              artistSlugs={{}}
              playlist={{
                spotifyUrl,
                youtubeMusicUrl,
                artists: 112,
                tracks: 0,
                updatedAt: "2026-11-23",
                coverage,
              }}
            />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
    const partial = { ...youtubeMusic, verified: { matchedArtists: 8, eligibleArtists: 110 } };
    const html = render({ spotify, youtubeMusic });
    const spotifyCard = html.split(`href="${spotifyUrl}"`)[1].split("</a>")[0];
    const youtubeCard = html.split(`href="${youtubeMusicUrl}"`)[1].split("</a>")[0];
    assert.ok(spotifyCard.includes(`${labels[0]}: 110`));
    assert.ok(spotifyCard.includes(spotify.recordedAt));
    assert.ok(spotifyCard.includes(labels[1]), "reported totals do not prove coverage");
    const verifiedCard = render({ spotify, youtubeMusic: partial })
      .split(`href="${youtubeMusicUrl}"`)[1]
      .split("</a>")[0];
    assert.ok(verifiedCard.includes(labels[2]));
    assert.ok(verifiedCard.includes("8 / 110"));
    assert.ok(!verifiedCard.includes(labels[1]));
    assert.ok(youtubeCard.includes(`${labels[0]}: 8`));
    assert.ok(youtubeCard.includes(youtubeMusic.recordedAt));
    const missingYoutubeCoverage = render({ spotify })
      .split(`href="${youtubeMusicUrl}"`)[1]
      .split("</a>")[0];
    assert.ok(missingYoutubeCoverage.includes(labels[1]));
    assert.doesNotMatch(missingYoutubeCoverage, /110|220|2026-11-20/);
    const reviewedSpotify = "https://open.spotify.com/playlist/Reviewed00000000000001";
    const reviewedYoutube = "https://music.youtube.com/playlist?list=ReviewedSynthetic";
    const mixed = render({ spotify, youtubeMusic }, { spotify: reviewedSpotify });
    assert.ok(mixed.split(`href="${reviewedSpotify}"`)[1].split("</a>")[0].includes(labels[1]));
    assert.ok(mixed.includes(youtubeMusic.recordedAt));
    assert.ok(!mixed.includes(spotify.recordedAt));
    const reviewedOnly = render(
      { spotify, youtubeMusic },
      { spotify: spotifyUrl, youtube_music: reviewedYoutube },
    );
    assert.ok(
      reviewedOnly.split(`href="${reviewedYoutube}"`)[1].split("</a>")[0].includes(labels[1]),
    );
    assert.ok(reviewedOnly.includes(spotify.recordedAt));
    assert.ok(!reviewedOnly.includes(youtubeMusic.recordedAt));
    const legacy = render();
    assert.ok(legacy.includes(labels[1]));
    assert.doesNotMatch(legacy, /112|2026-11-23/);
  });
}

for (const language of ["en", "de", "ru"] as const) {
  test(`festival cards and details separate dates from announced acts in ${language}`, () => {
    const announced = {
      ...festival,
      status: "tba" as const,
      startDate: undefined,
      endDate: undefined,
      lineup: Array.from({ length: 47 }, (_, index) => `Other Act ${index + 1}`),
    };
    const noActs = { ...festival, status: "partial" as const, headliners: [], lineup: [] };
    const verified = { ...announced, finalLineup: true as const };
    for (const item of [announced, verified, noActs]) {
      const hasActs = item !== noActs;
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <FestivalExplorer festivals={[item]} />
            <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
      const badge = translate(
        language,
        item === verified ? "finalLineup" : hasActs ? "actsAnnounced" : "noCurrentActs",
      );
      assert.equal(html.split(`>${badge}</span>`).length - 1, 2);
      assert.equal(html.includes(translate(language, "datesTba")), hasActs);
      if (hasActs) assert.ok(html.includes(`48 ${translate(language, "announcedActs")}`));
    }
  });
}

test("the public timetable distinguishes both occurrences of a repeated local time", () => {
  const shared = {
    date: "2027-10-31",
    start: "02:30",
    stage: "Main stage",
    timeZone: "Europe/Berlin",
    status: "scheduled" as const,
    sourceUrl: "https://festival.example.test/",
    observedAt: "2027-10-01T10:00:00Z",
  };
  const entries = ["+02:00", "+01:00"].map((offset, index) => ({
    ...shared,
    artist: `Fixture ${index + 1}`,
    window: {
      startsAt: `2027-10-31T02:30:00${offset}`,
      endsAt: `2027-10-31T02:50:00${offset}`,
    },
  }));
  const html = renderToStaticMarkup(
    <LanguageProvider initialLanguage="en">
      <StageTimetable entries={entries} />
    </LanguageProvider>,
  );
  for (const offset of ["02:00", "01:00"]) {
    assert.ok(html.includes(`>02:30 GMT+${offset}</time>`));
    assert.ok(html.includes(`>02:50 GMT+${offset}</time>`));
  }
});

for (const language of ["en", "de", "ru"] as const) {
  test(`home hero and metadata describe only a shared edition year in ${language}`, () => {
    const season = (editionYear: number | undefined, slug: string) => ({
      ...festival,
      editionYear,
      slug,
    });
    const renderEyebrow = (festivals: (typeof festival)[]) => {
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <HomeContent festivals={festivals} years={[2028, 2026]} freshness={{}} />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
      return html.match(/<section class="hero"><div class="eyebrow">([^<]+)<\/div>/)?.[1];
    };

    for (const year of [2026, 2027, 2028]) {
      const festivals = [season(year, "one"), season(year, "two")];
      const expectedTitle = `Loud Weekend ${year}`;
      assert.match(renderEyebrow(festivals) ?? "", new RegExp(`\\b${year}\\b`));
      const metadata = homeMetadata(language, festivals);
      assert.equal(metadata.title, expectedTitle);
      assert.equal(metadata.openGraph?.title, expectedTitle);
      assert.equal(metadata.twitter?.title, expectedTitle);
      assert.match(metadata.description ?? "", /^2\b/);
    }

    for (const festivals of [
      [],
      [season(2026, "one"), season(2028, "two")],
      [season(2028, "one"), season(undefined, "two")],
    ]) {
      const eyebrow = renderEyebrow(festivals);
      assert.ok(eyebrow);
      assert.doesNotMatch(eyebrow, /\d/);
      const metadata = homeMetadata(language, festivals);
      assert.equal(resolveTitle(metadata.title, "%s · Loud Weekend").absolute, "Loud Weekend");
      assert.equal(metadata.openGraph?.title, "Loud Weekend");
      assert.equal(metadata.twitter?.title, "Loud Weekend");
    }
  });
}
