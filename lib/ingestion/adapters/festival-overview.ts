import { load } from "cheerio";

const sources = {
  alcatraz: { city: "Kortrijk", countryCode: "BE", organizerHost: "alcatraz.be" },
  hellfest: { city: "Clisson", countryCode: "FR", organizerHost: "hellfest.fr" },
  "wacken-open-air": { city: "Wacken", countryCode: "DE", organizerHost: "wacken.com" },
} as const;

const plain = (text: string) => text.replace(/\s+/g, " ").trim();

export function overviewOrganizer(slug: string, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2099 || !Object.hasOwn(sources, slug))
    return;
  const identity = sources[slug as keyof typeof sources];
  const url =
    slug === "alcatraz"
      ? "https://alcatraz.be/en/stages"
      : slug === "hellfest"
        ? `https://hellfest.fr/en/news/hellfest-${year}-first-insights`
        : `https://www.wacken.com/de/rechtliches/agb-${year}/`;
  return { ...identity, url };
}

export function overviewSourceUrls(slug: string) {
  if (!Object.hasOwn(sources, slug)) return [];
  if (slug === "alcatraz") return [overviewOrganizer(slug, 2000)!.url];
  return Array.from({ length: 100 }, (_, index) => overviewOrganizer(slug, 2000 + index)!.url);
}

export function parseFestivalOverview(html: string, slug: string, year: number) {
  if (!overviewOrganizer(slug, year)) return;
  const $ = load(html);
  $(
    "script, style, noscript, template, header, nav, [hidden], [inert], [aria-hidden='true']",
  ).remove();
  $("[style]").each((_, el) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr("style") ?? ""))
      $(el).remove();
  });
  if (slug === "hellfest") {
    if (plain($(".article h1").text()) !== `HELLFEST ${year} - FIRST INSIGHTS`) return;
    const headings = $(".article .ck-content h4")
      .map((_, el) => plain($(el).text()))
      .get();
    const layouts = headings.flatMap((text) => {
      const match = /^Expanding from \d+ to ([1-9]\d?) stages and featuring over \d+ bands\b/.exec(
        text,
      );
      return match ? [match[1]] : [];
    });
    if (layouts.length !== 1) return;
    const [stageCount] = layouts;
    return {
      en: `The organizer announced ${stageCount} stages for the ${year} edition.`,
      de: `Der Veranstalter kündigte ${stageCount} Bühnen für die Ausgabe ${year} an.`,
      ru: `Организатор объявил количество сцен на ${year} год: ${stageCount}.`,
    };
  }
  if (slug === "alcatraz") {
    if (
      plain($("title").text()) !== `Stages | Alcatraz ${year}` ||
      plain($("h1").text()) !== "Stages"
    )
      return;
    const stages = $(".card-body > h5")
      .map((_, el) => plain($(el).text()))
      .get();
    if (
      !stages.length ||
      stages.some((name) => !/^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,49}$/u.test(name)) ||
      new Set(stages.map((name) => name.toLowerCase())).size !== stages.length ||
      stages.length > 20
    )
      return;
    const list = stages.join(", ");
    return {
      en: `The organizer lists these stages for ${year}: ${list}.`,
      de: `Der Veranstalter nennt diese Bühnen für ${year}: ${list}.`,
      ru: `Организатор перечисляет следующие сцены на ${year} год: ${list}.`,
    };
  }
  if (plain($("title").text()) !== `AGB ${year} - Event | Wacken Open Air`) return;
  const venues = $("p")
    .map((_, el) => plain($(el).text()))
    .get()
    .filter((text) => text.startsWith("1.3 Veranstaltungsgelände:"));
  if (venues.length !== 1) return;
  const venue = venues[0];
  if (
    !venue.startsWith(
      "1.3 Veranstaltungsgelände: Die Veranstaltung findet auf dem ausgewiesenen Festivalgelände ",
    ) ||
    !venue.includes("gehört insbesondere die Eventfläche der Gemeinde Wacken.") ||
    !venue.includes("Hierzu gehören auch das Gelände vor den Haupt- und Nebenbühnen")
  )
    return;
  return {
    en: "The organizer’s event terms include the main and side stage areas in the festival grounds in Wacken.",
    de: "Laut Veranstaltungsbedingungen gehören die Bereiche der Haupt- und Nebenbühnen zum Gelände in Wacken.",
    ru: "По условиям организатора территория фестиваля в Вакене включает зоны главных и дополнительных сцен.",
  };
}
