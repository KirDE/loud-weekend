import type { Festival } from "../domain/festival";
import type { SupportedLanguage } from "./public";

type Localized = Record<SupportedLanguage, string>;
type ArrivalFact = {
  kind: "venue" | "shuttle" | "railShuttle" | "camper";
  description: Localized;
  source: string;
};
type ArrivalRecord = {
  slug: string;
  year: number;
  organizer: string;
  countryCode: string;
  checkedOn: string;
  facts: readonly ArrivalFact[];
};

export const arrivalRecords: readonly ArrivalRecord[] = [
  {
    slug: "graspop", year: 2027, organizer: "graspop.be", countryCode: "BE", checkedOn: "2026-11-23",
    facts: [
      {
        kind: "venue",
        description: {
          en: "Festival Park Stenehei, Dessel, Belgium",
          de: "Festivalpark Stenehei, Dessel, Belgien",
          ru: "Фестивальный парк Stenehei, Дессел, Бельгия",
        },
        source: "https://www.graspop.be/en/info/festival-essentials",
      },
      {
        kind: "shuttle",
        description: {
          en: "The organizer offers paid shuttles from Brussels Airport, Brussels South Charleroi Airport, Eindhoven Airport and other stops in Belgium and the Netherlands. Check the organizer’s announcement for booking and onward details.",
          de: "Der Veranstalter bietet kostenpflichtige Shuttlebusse ab den Flughäfen Brüssel, Brüssel-Charleroi und Eindhoven sowie weiteren Haltestellen in Belgien und den Niederlanden an. Buchung und weitere Informationen stehen in der Ankündigung.",
          ru: "Организатор предлагает платные шаттлы из аэропортов Брюсселя, Брюссель-Шарлеруа и Эйндховена, а также с других остановок в Бельгии и Нидерландах. Бронирование и подробности — в объявлении организатора.",
        },
        source: "https://www.graspop.be/en/news/gmm2027-tickets-accommodations-gmm-app",
      },
      {
        kind: "railShuttle",
        description: {
          en: "Paid coaches connect Brussels-Midi and Eindhoven Centraal with the festival. Departure days vary by station, and the Monday return needs its own ticket. Check the shuttle operator’s timetable before booking a train.",
          de: "Kostenpflichtige Reisebusse verbinden Bruxelles-Midi und Eindhoven Centraal mit dem Festival. Die Abfahrtstage hängen vom Bahnhof ab. Für die Rückfahrt am Montag brauchst du ein eigenes Ticket. Prüfe vor der Zugbuchung den Shuttlefahrplan.",
          ru: "Платные автобусы идут к фестивалю от вокзалов Брюссель-Миди и Эйндховен-Централ. Дни отправления зависят от вокзала. На обратный шаттл в понедельник нужен отдельный билет. Перед покупкой билета на поезд проверьте расписание шаттла.",
        },
        source: "https://www.graspop.be/en/info/shuttles",
      },
    ],
  },
  {
    slug: "wacken-open-air", year: 2027, organizer: "wacken.com", countryCode: "DE", checkedOn: "2026-11-23",
    facts: [
      {
        kind: "camper",
        description: {
          en: "Vehicles entering the camping area need one Access Pass per vehicle, including for drop-off. The booking specifies an arrival day and a route category. Follow the organizer’s assigned route, not a generic route to Wacken.",
          de: "Für die Einfahrt zum Campinggelände ist je Fahrzeug ein Access Pass nötig, auch zum Ausladen. Bei der Buchung werden Anreisetag und Routenkategorie festgelegt. Folge der zugewiesenen Route statt einer allgemeinen Route nach Wacken.",
          ru: "Для въезда в кемпинг, в том числе для высадки, нужен один Access Pass на автомобиль. При бронировании указываются день заезда и категория маршрута. Следуйте маршруту организатора, а не общему маршруту в Вакен.",
        },
        source: "https://www.wacken.com/de/rechtliches/agb-2027/",
      },
    ],
  },
];

export function arrivalFacts(festival: Pick<Festival, "slug" | "officialUrl" | "editionYear" | "countryCode">) {
  let url: URL;
  try {
    url = new URL(festival.officialUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;

  const host = url.hostname.replace(/^www\./, "");
  return arrivalRecords.find((record) =>
    record.slug === festival.slug && record.year === festival.editionYear &&
    record.countryCode === festival.countryCode && record.organizer === host,
  );
}
