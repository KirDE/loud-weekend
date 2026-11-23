import type { Festival } from "../domain/festival.ts";

type Language = "en" | "de" | "ru";
type Overview = {
  slug: string;
  year: number;
  place: string;
  checkedOn: string;
  sources: string[];
  summary: Record<Language, string>;
};

// Editorial entries are reviewed with their official sources in the same change.
// They never update ticket, lineup, schedule, or ingestion freshness data.
export const editorialOverviews: readonly Overview[] = [
  {
    slug: "wacken-open-air",
    year: 2027,
    place: "Wacken",
    checkedOn: "2026-11-23",
    sources: ["https://www.wacken.com/de/rechtliches/agb-2027/"],
    summary: {
      en: "A four-day metal festival on the open-air grounds in Wacken, Schleswig-Holstein. The event covers the main and side stages, Wackinger Village and Bullhead City.",
      de: "Ein viertägiges Metal-Festival auf dem Freigelände in Wacken, Schleswig-Holstein. Zum Festival gehören Haupt- und Nebenbühnen, das Wackinger Village und die Bullhead City.",
      ru: "Четырёхдневный метал-фестиваль на открытой площадке в Вакене, земля Шлезвиг-Гольштейн. Помимо основных и дополнительных сцен, фестиваль включает Wackinger Village и Bullhead City.",
    },
  },
  {
    slug: "alcatraz",
    year: 2027,
    place: "Kortrijk",
    checkedOn: "2026-11-23",
    sources: ["https://alcatraz.be/en/stages"],
    summary: {
      en: "An open-air metal festival in Kortrijk spread over four days. The Prison stage hosts headliners outdoors; the Swamp marquee focuses on extreme metal, including death, black and thrash metal.",
      de: "Ein viertägiges Open-Air-Metal-Festival in Kortrijk. Auf der Prison-Bühne spielen Headliner im Freien; das Swamp-Zelt widmet sich unter anderem Death, Black und Thrash Metal.",
      ru: "Четырёхдневный метал-фестиваль под открытым небом в Кортрейке. Хедлайнеры выступают на открытой сцене Prison, а шатёр Swamp посвящён экстремальному металу, в том числе дэт-, блэк- и трэш-металу.",
    },
  },
  {
    slug: "hellfest",
    year: 2027,
    place: "Clisson",
    checkedOn: "2026-11-23",
    sources: ["https://hellfest.fr/en/news/hellfest-2027-first-insights", "https://hellfest.fr/news/hellfest-2027"],
    summary: {
      en: "Four days of extreme music in Clisson. For the 20th edition, the organizer announced ten stages, including the two main stages and pairs such as Warzone and Riot.",
      de: "Vier Tage extreme Musik in Clisson. Für die 20. Ausgabe kündigte der Veranstalter zehn Bühnen an, darunter zwei Hauptbühnen und Bühnenpaare wie Warzone und Riot.",
      ru: "Четыре дня экстремальной музыки в Клиссоне. Для 20-го выпуска организатор объявил десять сцен, включая две главные и парные площадки, такие как Warzone и Riot.",
    },
  },
];

export function festivalOverview(item: Pick<Festival, "slug" | "editionYear" | "city">) {
  return editorialOverviews.find(({ slug, year, place }) =>
    slug === item.slug && year === item.editionYear && place === item.city);
}
