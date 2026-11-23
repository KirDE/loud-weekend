import type { Festival } from "../domain/festival";

type Localized = Record<"en" | "de" | "ru", string>;
type CampingField = "camping" | "arrival" | "accessibility" | "facilities" | "motorhomes" | "viewing";
type Fact = { field: Exclude<CampingField, "arrival">; description: Localized } | {
  field: "arrival"; earliestDate: string;
};
type CampingRecord = {
  slug: string;
  year: number;
  city: string;
  organizer: string;
  source: string;
  checkedOn: string;
  facts: readonly Fact[];
};

export const campingRecords: readonly CampingRecord[] = [
  {
    slug: "wacken-open-air", year: 2027, city: "Wacken", organizer: "wacken.com",
    source: "https://www.wacken.com/en/news-details/woa-camping-2027-all-info-regarding-the-pre-sale/",
    checkedOn: "2026-11-23",
    facts: [
      { field: "camping", description: {
        en: "Standard camping is included with the festival ticket.",
        de: "Reguläres Camping ist im Festivalticket enthalten.",
        ru: "Обычный кемпинг включён в фестивальный билет.",
      } },
      { field: "arrival", earliestDate: "2027-07-26" },
      { field: "accessibility", description: {
        en: "The organizer lists Wheels of Steel as a designated camping area for people with disabilities. Check the organizer’s information for the specific facilities and booking conditions.",
        de: "Der Veranstalter nennt Wheels of Steel als ausgewiesenen Campingbereich für Menschen mit Behinderung. Ausstattung und Buchungsbedingungen stehen beim Veranstalter.",
        ru: "Организатор указывает Wheels of Steel как отдельную зону кемпинга для людей с инвалидностью. Уточняйте оснащение и условия бронирования у организатора.",
      } },
    ],
  },
  {
    slug: "alcatraz", year: 2027, city: "Kortrijk", organizer: "alcatraz.be",
    source: "https://alcatraz.be/en/camping", checkedOn: "2026-11-23",
    facts: [
      { field: "camping", description: {
        en: "Each camper needs a separate campsite ticket.",
        de: "Jede Person auf dem Campingplatz benötigt ein separates Campingticket.",
        ru: "Для каждого гостя кемпинга требуется отдельный кемпинговый билет.",
      } },
      { field: "arrival", earliestDate: "2027-08-05" },
      { field: "facilities", description: {
        en: "The campsite has showers and toilets with running water, available around the clock.",
        de: "Auf dem Campingplatz sind Duschen und Toiletten mit fließendem Wasser rund um die Uhr zugänglich.",
        ru: "Душевые и туалеты с проточной водой доступны гостям кемпинга круглосуточно.",
      } },
      { field: "motorhomes", description: {
        en: "Motorhome pitches include one electrical hookup. A motorhome pitch ticket does not replace the campsite ticket required for each camper.",
        de: "Wohnmobilstellplätze haben je einen Stromanschluss. Das Stellplatzticket ersetzt nicht das Campingticket pro Person.",
        ru: "На каждом месте для автодома есть одно подключение к электросети. Билет на место не заменяет кемпинговый билет для каждого гостя.",
      } },
    ],
  },
  {
    slug: "graspop", year: 2027, city: "Dessel", organizer: "graspop.be",
    source: "https://www.graspop.be/en/info/accessibility", checkedOn: "2026-11-23",
    facts: [
      { field: "accessibility", description: {
        en: "The Inter campsite is part of Inferno. Places are limited and require an application to Inter by 31 May 2027. Access requires both a festival wristband and a paid camping wristband.",
        de: "Der Inter-Campingbereich gehört zu Inferno. Die Plätze sind begrenzt; der Antrag bei Inter ist bis zum 31. Mai 2027 nötig. Für den Zutritt sind ein Festivalarmband und ein kostenpflichtiges Campingarmband erforderlich.",
        ru: "Кемпинг Inter находится на территории Inferno. Число мест ограничено; заявку в Inter нужно подать до 31 мая 2027 года. Для входа нужны фестивальный браслет и платный браслет кемпинга.",
      } },
      { field: "facilities", description: {
        en: "The Inter campsite has accessible showers and toilets. Electricity in the care tent is for medical use only.",
        de: "Im Inter-Campingbereich gibt es barrierefreie Duschen und Toiletten. Strom im Betreuungszelt ist medizinischen Zwecken vorbehalten.",
        ru: "В кемпинге Inter есть доступные душевые и туалеты. Электричество в палатке помощи предназначено только для медицинских нужд.",
      } },
      { field: "viewing", description: {
        en: "The main stages, Jupiler Stage and Marquee have raised viewing platforms for visitors with disabilities. One companion may join them on the platform.",
        de: "An den Hauptbühnen, der Jupiler Stage und der Marquee gibt es erhöhte Plattformen für Menschen mit Behinderung. Eine Begleitperson darf mit auf die Plattform.",
        ru: "У главных сцен, Jupiler Stage и Marquee есть приподнятые площадки для зрителей с инвалидностью. На площадку можно пройти с одним сопровождающим.",
      } },
    ],
  },
];

export function campingFacts(festival: Pick<Festival, "slug" | "officialUrl" | "editionYear" | "city">) {
  let organizer;
  try {
    const url = new URL(festival.officialUrl);
    if (url.protocol !== "https:") return undefined;
    organizer = url.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return campingRecords.find(record =>
    record.slug === festival.slug && record.year === festival.editionYear
    && record.city === festival.city && record.organizer === organizer);
}
