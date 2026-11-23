import { load } from "cheerio";

export const arrivalSources = {
  graspop: { countryCode: "BE", organizerHost: "graspop.be" },
  "wacken-open-air": { countryCode: "DE", organizerHost: "wacken.com" },
} as const;
export type ArrivalSlug = keyof typeof arrivalSources;

export function arrivalSourceUrls(slug: ArrivalSlug, year: number) {
  return slug === "graspop"
    ? [
        "https://www.graspop.be/en/info/festival-essentials",
        `https://www.graspop.be/en/news/gmm${year}-tickets-accommodations-gmm-app`,
      ]
    : [`https://www.wacken.com/de/rechtliches/agb-${year}/`];
}

const plain = (text: string) => text.replace(/\s+/g, " ").trim();

function visiblePage(html: string) {
  const $ = load(html);
  $(
    "script,style,noscript,template,header,footer,nav,[hidden],[inert],[aria-hidden='true']",
  ).remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  return $;
}

function singleMatch(lines: string[], pattern: RegExp) {
  const matches = lines.map((text) => text.match(pattern)).filter((match) => match !== null);
  return matches.length === 1 ? matches[0] : undefined;
}

export function parseGraspopArrival(essentials: string, announcement: string, year: number) {
  const $ = visiblePage(essentials);
  const venueAnswer = $("details.faq-item").filter(
    (_, item) =>
      plain($(item).children("summary").text()) ===
      "Where and when does Graspop Metal Meeting take place?",
  );
  if (venueAnswer.length !== 1) return;
  const place = singleMatch(
    venueAnswer
      .find("p")
      .map((_, item) => plain($(item).text()))
      .get(),
    new RegExp(
      String.raw`^Graspop Metal Meeting (20\d{2}) takes place from \d{1,2} through \d{1,2} [A-Z][a-z]+ ` +
        String.raw`in ([^,.]{1,80}), ([^,.]{1,80}) \(Belgium\)\.$`,
    ),
  );
  if (!place || Number(place[1]) !== year) return;
  const [, , venue, city] = place;
  const news = visiblePage(announcement);
  if (!plain(news("h1").text()).startsWith(`GMM ${year}: tickets, accommodations`)) return;
  const heading = news("h3").filter((_, item) => /^SHUTTLES\b/.test(plain(news(item).text())));
  if (heading.length !== 1) return;
  const row = heading.closest("[data-block-type]");
  const paragraph = row.next("[data-block-type=paragraph]").find("p");
  const shuttle = singleMatch(
    paragraph.map((_, item) => plain(news(item).text())).get(),
    new RegExp(
      String.raw`\bFans travelling from ([^.!?]{1,150}) and \d+ locations across Belgium and the ` +
        String.raw`Netherlands can book a paid shuttle\b`,
    ),
  );
  if (!shuttle) return;
  const airports = shuttle[1].split(", ").map(plain);
  if (airports.length < 1 || airports.some((name) => !/^[\p{L} .'-]{1,65} Airport$/u.test(name)))
    return;
  const list = airports.join(", ");
  return [
    {
      kind: "venue",
      description: {
        en: `${venue}, ${city}, Belgium`,
        de: `${venue}, ${city}, Belgien`,
        ru: `${venue}, ${city}, Бельгия`,
      },
    },
    {
      kind: "shuttle",
      description: {
        en: `The organizer offers paid shuttles from ${list} and other stops in Belgium and the Netherlands.`,
        de:
          `Der Veranstalter bietet kostenpflichtige Shuttlebusse ab ${list} ` +
          "sowie weiteren Haltestellen in Belgien und den Niederlanden an.",
        ru: `Организатор предлагает платные шаттлы из ${list}, а также с других остановок в Бельгии и Нидерландах.`,
      },
    },
  ] as const;
}

export function parseWackenArrival(html: string, year: number) {
  const $ = visiblePage(html);
  if (!new RegExp(`^AGB ${year}\\b`).test(plain($("title").text()))) return;
  const clauses = $("p")
    .map((_, item) => plain($(item).text()))
    .get();
  const pass = singleMatch(
    clauses,
    new RegExp(
      String.raw`^4\.2 Pro Fahrzeug ist ein Access Pass zu buchen,[^.]+\. Das Befahren der ` +
        String.raw`Campingfläche lediglich zum Ausladen, bzw\. Aussteigen ohne Access Pass ist nicht ` +
        String.raw`gestattet\.$`,
    ),
  );
  const booking = singleMatch(
    clauses,
    new RegExp(
      String.raw`^4\.3 Bei der Buchung der Access Passes ist verbindlich ein Anreisetag zu wählen\..* ` +
        String.raw`Bei der Buchung ist außerdem eine vom Veranstalter zu definierende Routenkategorie zu ` +
        String.raw`wählen, die u\.a\. die Zufahrtsrichtungen bei der Anreise vorgibt\b`,
    ),
  );
  if (!pass || !booking) return;
  return {
    kind: "camper",
    description: {
      en:
        "Vehicles entering the camping area need one Access Pass per vehicle, including for drop-off. " +
        "The booking specifies an arrival day and route category.",
      de:
        "Für die Einfahrt zum Campinggelände ist je Fahrzeug ein Access Pass nötig, auch zum Ausladen. " +
        "Bei der Buchung werden Anreisetag und Routenkategorie festgelegt.",
      ru:
        "Для въезда в кемпинг, в том числе для высадки, нужен один Access Pass на автомобиль. " +
        "При бронировании указываются день заезда и категория маршрута.",
    },
  } as const;
}

const railOrganizerUrl = "https://www.graspop.be/en/info/shuttles";
const railOperatorUrl = "https://www.event-shuttle.be/en/GMM_Airport-rail-shuttle-c89443cc";

export function graspopRailSources(slug: ArrivalSlug) {
  return slug === "graspop" ? ([railOrganizerUrl, railOperatorUrl] as const) : undefined;
}

const railStations = [
  {
    organizer: "Brussels South railway station",
    inbound: "Brussels Midi Station",
    outbound: "Station Brussels South (Gare du Midi)",
    label: "Brussels-Midi",
  },
  {
    organizer: "Eindhoven Central Station",
    inbound: "Eindhoven Railway station",
    outbound: "Eindhoven Railway station",
    label: "Eindhoven Centraal",
  },
];

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parseGraspopRailShuttle(
  organizerHtml: string,
  timetableHtml: string,
  year: number,
) {
  const organizer = visiblePage(organizerHtml);
  const details = organizer("details.faq-item").filter(
    (_, el) => plain(organizer(el).children("summary").text()) === "AIRPORT / RAILWAY SHUTTLES",
  );
  const link = details.closest(".pagecontent-row-container").find(`a[href="${railOperatorUrl}"]`);
  if (
    details.length !== 1 ||
    link.length !== 1 ||
    plain(link.text()).toLowerCase() !== "airport / railway shuttles tickets"
  )
    return;
  const policy = singleMatch(
    details
      .find("p")
      .map((_, el) => plain(organizer(el).text()))
      .get(),
    new RegExp(
      String.raw`^On the Monday after the festival, you can take a shuttle straight back to the ` +
        String.raw`airports or railway stations\. A separate ticket is required for this journey\.$`,
    ),
  );
  if (!policy) return;

  const listed = details
    .find("li")
    .map((_, el) => plain(organizer(el).text()))
    .get();
  const timetable = visiblePage(timetableHtml);
  const tables = timetable("table").filter((_, el) =>
    timetable(el)
      .find("td")
      .toArray()
      .some((cell) => /one-way (?:inbound|outbound) transfer$/.test(plain(timetable(cell).text()))),
  );
  if (tables.length !== 1) return;
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  let direction: "inbound" | "outbound" | undefined;
  let dateCount = 0;
  let badSection = false;
  tables.find("tr").each((_, row) => {
    const cells = timetable(row)
      .children("td,th")
      .map((_, el) => plain(timetable(el).text()))
      .get();
    if (cells.length === 1) {
      direction = undefined;
      const match =
        /^(\w+) - (\d{2})\/(\d{2})\/(20\d{2}) - one-way (inbound|outbound) transfer$/.exec(
          cells[0],
        );
      if (!match) return;
      const [, weekday, day, month, edition, kind] = match;
      const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
      if (
        Number(edition) !== year ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== Number(month) ||
        date.getUTCDate() !== Number(day) ||
        days[date.getUTCDay()] !== weekday
      ) {
        badSection = true;
        return;
      }
      dateCount++;
      if (kind === "inbound" || weekday === "Monday") direction = kind as "inbound" | "outbound";
      return;
    }
    if (cells.length !== 4 || !/^\d{1,2}h\d{2}$/.test(cells[1])) return;
    if (direction === "inbound" && cells[2] === "GMM Dessel") inbound.add(cells[0]);
    if (direction === "outbound" && cells[0] === "GMM busparking") outbound.add(cells[2]);
  });
  if (badSection || dateCount === 0) return;
  const stations = railStations.filter(
    (station) =>
      listed.includes(station.organizer) &&
      inbound.has(station.inbound) &&
      outbound.has(station.outbound),
  );
  if (!stations.length) return;
  const names = stations.map((station) => station.label).join(", ");
  return {
    kind: "railShuttle",
    sourceUrl: railOrganizerUrl,
    supportingSourceUrl: railOperatorUrl,
    description: {
      en: `Verified rail shuttle stops: ${names}. Monday return trips require a separate ticket. Check the timetable.`,
      de:
        `Bestätigte Bahnhaltestellen: ${names}. ` +
        "Für die Rückfahrt am Montag ist ein separates Ticket nötig. Fahrplan beachten.",
      ru:
        `Подтверждённые остановки у вокзалов: ${names}. ` +
        "На обратный рейс в понедельник нужен отдельный билет. Сверьтесь с расписанием.",
    },
  } as const;
}
