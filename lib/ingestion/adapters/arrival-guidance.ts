import { load } from "cheerio";

export const arrivalSources = {
  graspop: { countryCode: "BE", organizerHost: "graspop.be" },
  "wacken-open-air": { countryCode: "DE", organizerHost: "wacken.com" },
} as const;
export type ArrivalSlug = keyof typeof arrivalSources;

export function arrivalSourceUrls(slug: ArrivalSlug, year: number) {
  return slug === "graspop" ? [
    "https://www.graspop.be/en/info/festival-essentials",
    `https://www.graspop.be/en/news/gmm${year}-tickets-accommodations-gmm-app`,
  ] : [`https://www.wacken.com/de/rechtliches/agb-${year}/`];
}

const plain = (text: string) => text.replace(/\s+/g, " ").trim();

function visiblePage(html: string) {
  const $ = load(html);
  $("script,style,noscript,template,header,footer,nav,[hidden],[inert],[aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? "")) $(element).remove();
  });
  return $;
}

function singleMatch(lines: string[], pattern: RegExp) {
  const matches = lines.map(text => text.match(pattern)).filter(match => match !== null);
  return matches.length === 1 ? matches[0] : undefined;
}

export function parseGraspopArrival(essentials: string, announcement: string, year: number) {
  const $ = visiblePage(essentials);
  const venueAnswer = $("details.faq-item").filter((_, item) =>
    plain($(item).children("summary").text()) === "Where and when does Graspop Metal Meeting take place?");
  if (venueAnswer.length !== 1) return;
  const place = singleMatch(venueAnswer.find("p").map((_, item) => plain($(item).text())).get(),
    /^Graspop Metal Meeting (20\d{2}) takes place from \d{1,2} through \d{1,2} [A-Z][a-z]+ in ([^,.]{1,80}), ([^,.]{1,80}) \(Belgium\)\.$/);
  if (!place || Number(place[1]) !== year) return;
  const [, , venue, city] = place;
  const news = visiblePage(announcement);
  if (!plain(news("h1").text()).startsWith(`GMM ${year}: tickets, accommodations`)) return;
  const heading = news("h3").filter((_, item) => /^SHUTTLES\b/.test(plain(news(item).text())));
  if (heading.length !== 1) return;
  const row = heading.closest("[data-block-type]");
  const paragraph = row.next("[data-block-type=paragraph]").find("p");
  const shuttle = singleMatch(paragraph.map((_, item) => plain(news(item).text())).get(),
    /\bFans travelling from ([^.!?]{1,150}) and \d+ locations across Belgium and the Netherlands can book a paid shuttle\b/);
  if (!shuttle) return;
  const airports = shuttle[1].split(", ").map(plain);
  if (airports.length < 1 || airports.some(name => !/^[\p{L} .'-]{1,65} Airport$/u.test(name))) return;
  const list = airports.join(", ");
  return [
    { kind: "venue", description: { en: `${venue}, ${city}, Belgium`, de: `${venue}, ${city}, Belgien`, ru: `${venue}, ${city}, Бельгия` } },
    { kind: "shuttle", description: {
      en: `The organizer offers paid shuttles from ${list} and other stops in Belgium and the Netherlands.`,
      de: `Der Veranstalter bietet kostenpflichtige Shuttlebusse ab ${list} sowie weiteren Haltestellen in Belgien und den Niederlanden an.`,
      ru: `Организатор предлагает платные шаттлы из ${list}, а также с других остановок в Бельгии и Нидерландах.`,
    } },
  ] as const;
}

export function parseWackenArrival(html: string, year: number) {
  const $ = visiblePage(html);
  if (!new RegExp(`^AGB ${year}\\b`).test(plain($("title").text()))) return;
  const clauses = $("p").map((_, item) => plain($(item).text())).get();
  const pass = singleMatch(clauses, /^4\.2 Pro Fahrzeug ist ein Access Pass zu buchen,[^.]+\. Das Befahren der Campingfläche lediglich zum Ausladen, bzw\. Aussteigen ohne Access Pass ist nicht gestattet\.$/);
  const booking = singleMatch(clauses, /^4\.3 Bei der Buchung der Access Passes ist verbindlich ein Anreisetag zu wählen\..* Bei der Buchung ist außerdem eine vom Veranstalter zu definierende Routenkategorie zu wählen, die u\.a\. die Zufahrtsrichtungen bei der Anreise vorgibt\b/);
  if (!pass || !booking) return;
  return { kind: "camper", description: {
    en: "Vehicles entering the camping area need one Access Pass per vehicle, including for drop-off. The booking specifies an arrival day and route category.",
    de: "Für die Einfahrt zum Campinggelände ist je Fahrzeug ein Access Pass nötig, auch zum Ausladen. Bei der Buchung werden Anreisetag und Routenkategorie festgelegt.",
    ru: "Для въезда в кемпинг, в том числе для высадки, нужен один Access Pass на автомобиль. При бронировании указываются день заезда и категория маршрута.",
  } } as const;
}
