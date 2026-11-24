import { load } from "cheerio";

export const campingSources = {
  alcatraz: {
    city: "Kortrijk",
    countryCode: "BE",
    organizerHost: "alcatraz.be",
  },
  "wacken-open-air": {
    city: "Wacken",
    countryCode: "DE",
    organizerHost: "wacken.com",
  },
  graspop: { city: "Dessel", countryCode: "BE", organizerHost: "graspop.be" },
} as const;
export type CampingSlug = keyof typeof campingSources;

const graspopAccessibilityUrl = "https://www.graspop.be/en/info/accessibility";
const alcatrazCampingUrl = "https://alcatraz.be/en/camping";
const wackenCampingPrefix = "https://www.wacken.com/en/news-details/woa-camping-";

export const campingSourceFilters = [
  { requestedUrl: alcatrazCampingUrl },
  { requestedUrl: graspopAccessibilityUrl },
  {
    requestedUrl: {
      startsWith: wackenCampingPrefix,
      endsWith: "-all-info-regarding-the-pre-sale/",
    },
  },
];

export function campingSourceUrl(slug: CampingSlug, year: number) {
  if (slug === "graspop") return graspopAccessibilityUrl;
  return slug === "alcatraz"
    ? alcatrazCampingUrl
    : `${wackenCampingPrefix}${year}-all-info-regarding-the-pre-sale/`;
}

export function isCampingSourceUrl(slug: string, url: string) {
  if (!Object.hasOwn(campingSources, slug)) return false;
  if (slug === "alcatraz") return url === alcatrazCampingUrl;
  if (slug === "graspop") return url === graspopAccessibilityUrl;
  const year = url.match(/-camping-(20\d{2})-all-info-regarding-the-pre-sale\/$/)?.[1];
  return !!year && campingSourceUrl(slug as CampingSlug, Number(year)) === url;
}

const copy = {
  separate: {
    en: "Each camper needs a separate campsite ticket.",
    de: "Jede Person auf dem Campingplatz benötigt ein separates Campingticket.",
    ru: "Для каждого гостя кемпинга требуется отдельный кемпинговый билет.",
  },
  included: {
    en: "Standard camping is included with the festival ticket.",
    de: "Reguläres Camping ist im Festivalticket enthalten.",
    ru: "Обычный кемпинг включён в фестивальный билет.",
  },
  showers: {
    en: "The campsite has showers and toilets with running water, available around the clock.",
    de: "Auf dem Campingplatz sind Duschen und Toiletten mit fließendem Wasser rund um die Uhr zugänglich.",
    ru: "Душевые и туалеты с проточной водой доступны гостям кемпинга круглосуточно.",
  },
  motorhome: {
    en:
      "Motorhome pitches include one electrical hookup. A motorhome pitch " +
      "ticket does not replace the campsite ticket required for each camper.",
    de:
      "Wohnmobilstellplätze haben je einen Stromanschluss. " +
      "Das Stellplatzticket ersetzt nicht das Campingticket pro Person.",
    ru:
      "На каждом месте для автодома есть одно подключение к электросети. " +
      "Билет на место не заменяет кемпинговый билет для каждого гостя.",
  },
  accessibility: {
    en:
      "The organizer lists Wheels of Steel as a designated camping area for people with disabilities. " +
      "Check the organizer’s information for the specific facilities and booking conditions.",
    de:
      "Der Veranstalter nennt Wheels of Steel als ausgewiesenen Campingbereich für Menschen mit Behinderung. " +
      "Ausstattung und Buchungsbedingungen stehen beim Veranstalter.",
    ru:
      "Организатор указывает Wheels of Steel как отдельную зону кемпинга для людей с инвалидностью. " +
      "Уточняйте оснащение и условия бронирования у организатора.",
  },
};

const plain = (text: string) => text.replace(/\s+/g, " ").trim();
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function observedDate(year: number, month: number, day: number, weekday: string) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    weekdays[date.getUTCDay()] === weekday
  )
    return date.toISOString().slice(0, 10);
}

function singleMatch(paragraphs: string[], pattern: RegExp) {
  const matches = paragraphs
    .map((paragraph) => paragraph.match(pattern))
    .filter((match) => match !== null);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Recognize only explicit, positive organizer statements. An incomplete or
 * changed policy never falls back to the previous bundle's assertions. */
export function parseCampingGuidance(html: string, slug: CampingSlug, year: number) {
  const $ = load(html);
  $(
    "script,style,noscript,template,header,footer,nav,[hidden],[inert],[aria-hidden='true']",
  ).remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  if (slug === "graspop") return parseGraspopAccessibility($, year);
  if (slug === "alcatraz") {
    if (
      plain($("title").text()) !== `Camping | Alcatraz ${year}` ||
      plain($("h1").text()) !== "Camping"
    )
      return;
    const paragraphs = $("p")
      .map((_, item) => plain($(item).text()))
      .get();
    const dates = singleMatch(
      paragraphs,
      new RegExp(
        String.raw`^The Alcatraz campsite is open from (\w+) (\d{1,2})/(\d{1,2}) \((\d{1,2})h\) ` +
          String.raw`till (\w+) (\d{1,2})/(\d{1,2}) \((noon|\d{1,2}h)\)\.?$`,
      ),
    );
    if (!dates) return;
    const [
      ,
      openingWeekday,
      openingDay,
      openingMonth,
      openingTime,
      closingWeekday,
      closingDay,
      closingMonth,
      closingTime,
    ] = dates;
    const earliestDate = observedDate(year, +openingMonth, +openingDay, openingWeekday);
    const closingDate = observedDate(year, +closingMonth, +closingDay, closingWeekday);
    const closingHour = closingTime === "noon" ? 12 : Number(closingTime.slice(0, -1));
    if (
      !earliestDate ||
      !closingDate ||
      earliestDate > closingDate ||
      +openingTime > 23 ||
      closingHour > 23 ||
      (earliestDate === closingDate && +openingTime >= closingHour)
    )
      return;
    const graveyard = $("h5").filter((_, el) => plain($(el).text()) === "Alcatraz Graveyard");
    const motorhomes = $("h5").filter((_, el) => plain($(el).text()) === "Motorhomes");
    if (graveyard.length !== 1 || motorhomes.length !== 1) return;
    const pass = graveyard
      .siblings("p")
      .map((_, el) => plain($(el).text()))
      .get();
    const motor = motorhomes
      .siblings("p")
      .map((_, el) => plain($(el).text()))
      .get();
    const corroborated = pass.some((item) =>
      item.includes(
        `The campsite is open from ${openingWeekday} ${+openingDay} ` +
          `${months[+openingMonth - 1]} at `,
      ),
    );
    if (
      !corroborated ||
      !singleMatch(
        pass,
        /^Remember to purchase your camping tickets \([^)]*compulsory for every camper\) in advance/,
      ) ||
      !singleMatch(
        paragraphs,
        /^24\/7 free access to clean, well-maintained sanitary facilities \(showers and toilets with running water\)/,
      ) ||
      !singleMatch(
        motor,
        new RegExp(
          String.raw`^At the Motorhome Campsite[^]*?\. 1 electric hook-up \([^)]*\) is provided per ` +
            String.raw`motorhome\/caravan\.[^]*?\(camping ticket compulsory for every camper\)$`,
        ),
      )
    )
      return;
    return [
      { field: "camping", description: copy.separate },
      { field: "arrival", earliestDate },
      { field: "facilities", description: copy.showers },
      { field: "motorhomes", description: copy.motorhome },
    ] as const;
  }

  if (
    !plain($("h1[itemprop=headline]").text()).startsWith(`W:O:A Camping ${year} - `) ||
    $("article").length !== 1
  )
    return;
  const paragraphs = $("article p")
    .map((_, item) => plain($(item).text()))
    .get();
  const date = singleMatch(
    paragraphs,
    /\bthe earliest arrival day will (?:once again )?be (\w+), (\w+) (\d{1,2}), (20\d{2})\.$/,
  );
  const earliestDate =
    Number(date?.[4]) === year && date
      ? observedDate(year, months.indexOf(date[2]) + 1, +date[3], date[1])
      : undefined;
  if (
    !earliestDate ||
    !singleMatch(
      paragraphs,
      /^And in case you were wondering: Yes, regular camping is, as always, included in your festival ticket!$/,
    ) ||
    !singleMatch(
      paragraphs,
      /\balong with the "Wheels of Steel" area \(for people with disabilities\)\./,
    )
  )
    return;
  return [
    { field: "camping", description: copy.included },
    { field: "arrival", earliestDate },
    { field: "accessibility", description: copy.accessibility },
  ] as const;
}

function parseGraspopAccessibility($: ReturnType<typeof load>, year: number) {
  const section = (title: string) =>
    $("details.faq-item").filter((_, el) => plain($(el).children("summary").text()) === title);
  const campsite = section("THE INTER CAMPSITE");
  const arena = section("IN THE FESTIVAL ARENA");
  if (plain($("h1").text()) !== "Accessibility" || campsite.length !== 1 || arena.length !== 1)
    return;
  const text = plain(campsite.text());
  const opening =
    /The Inter camping is open for combi ticket holders from \d{1,2} pm on (\w+) (\d{1,2}) (\w+) (20\d{2})\./g;
  const dates = [...text.matchAll(opening)];
  if (dates.length !== 1 || Number(dates[0][4]) !== year) return;
  const [, weekday, day, month] = dates[0];
  if (!observedDate(year, months.indexOf(month) + 1, Number(day), weekday)) return;
  const application = singleMatch(
    $("p")
      .map((_, el) => plain($(el).text()))
      .get(),
    /contact Inter as soon as possible \(and by (\d{1,2}) (\w+) (20\d{2}) at the latest\)\./,
  );
  if (!application || Number(application[3]) !== year) return;
  const deadline = new Date(Date.UTC(year, months.indexOf(application[2]), Number(application[1])));
  if (
    deadline.getUTCFullYear() !== year ||
    months[deadline.getUTCMonth()] !== application[2] ||
    deadline.getUTCDate() !== Number(application[1])
  )
    return;
  if (
    !text.includes("It is part of campsite Inferno.") ||
    !text.includes(
      "Access to the Inter campsite requires a valid festival wristband and camping wristband.",
    ) ||
    !text.includes("This dedicated zone includes accessible showers, washbasins and toilets.")
  )
    return;
  const viewing = singleMatch(
    arena
      .find("p")
      .map((_, el) => plain($(el).text()))
      .get(),
    new RegExp(
      String.raw`(?:^|[.!?]\s*)The main stages, the ([\p{L} .'-]{1,50}) and the ([\p{L} .'-]{1,50}) ` +
        String.raw`have raised platforms for wheelchair users and persons with a disability\. One carer ` +
        String.raw`can join them on the platform\.`,
      "u",
    ),
  );
  if (!viewing) return;
  const shown = (locale: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(deadline);
  return [
    {
      field: "accessibility",
      description: {
        en:
          `Apply to Inter by ${shown("en-GB")}. ` +
          "The Inferno accessibility campsite requires festival and camping wristbands.",
        de:
          `Antrag bei Inter bis ${shown("de-DE")}. ` +
          "Für den barrierefreien Inferno-Bereich sind Festival- und Campingarmbänder nötig.",
        ru:
          `Подайте заявку в Inter до ${shown("ru-RU")}. ` +
          "Для доступной зоны Inferno нужны фестивальный и кемпинговый браслеты.",
      },
    },
    {
      field: "facilities",
      description: {
        en: "The Inter campsite has accessible showers, washbasins and toilets.",
        de: "Der Inter-Campingplatz hat barrierefreie Duschen, Waschbecken und Toiletten.",
        ru: "В кемпинге Inter есть доступные душевые, умывальники и туалеты.",
      },
    },
    {
      field: "viewing",
      description: {
        en: `The main stages, ${viewing[1]} and ${viewing[2]} have raised platforms. One carer may join.`,
        de:
          `An den Hauptbühnen, ${viewing[1]} und ${viewing[2]} gibt es erhöhte Plattformen. ` +
          "Eine Begleitperson darf mit.",
        ru:
          `У главных сцен, ${viewing[1]} и ${viewing[2]} есть приподнятые площадки. ` +
          "Разрешён один сопровождающий.",
      },
    },
  ] as const;
}
