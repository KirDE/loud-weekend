const prefix = "festival-radar-offline-trip:v1:";
const maximumBytes = 192 * 1024;
const shortText = (value) => typeof value === "string" && value.length > 0 && value.length <= 300;
const isoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const instant = (value) =>
  typeof value === "string" &&
  value.length === 24 &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export const offlineTripCopy = {
  en: {
    heading: "Offline trip details",
    save: "Save trip offline",
    update: "Update offline copy",
    remove: "Remove offline copy",
    open: "Open offline trips",
    saved: "Trip details saved on this device.",
    removed: "Offline copy removed.",
    pending: "Downloading…",
    unavailable: "Could not download the trip. The previous copy, if any, was kept.",
    storage: "Could not change the offline copy. Check browser storage or remove an older trip.",
    stale: "Offline copy. Verify dates, travel details and times when you reconnect.",
    savedAt: "Downloaded",
    checkedAt: "Catalogue last updated",
    performanceChecked: "Schedule checked",
    dates: "Dates not published",
    place: "Festival location",
    timetable: "No verified timetable in this copy",
    cancelled: "Cancelled",
    empty: "No trip details saved on this device.",
  },
  de: {
    heading: "Offline-Reisedetails",
    save: "Reise offline speichern",
    update: "Offline-Kopie aktualisieren",
    remove: "Offline-Kopie entfernen",
    open: "Offline-Reisen öffnen",
    saved: "Reisedetails wurden auf diesem Gerät gespeichert.",
    removed: "Offline-Kopie entfernt.",
    pending: "Wird heruntergeladen…",
    unavailable: "Reisedetails nicht verfügbar. Eine vorhandene Kopie wurde behalten.",
    storage:
      "Offline-Kopie konnte nicht geändert werden. Browserspeicher prüfen oder eine ältere Reise entfernen.",
    stale: "Offline-Kopie. Termine, Anreise und Uhrzeiten nach dem Verbinden prüfen.",
    savedAt: "Heruntergeladen",
    checkedAt: "Katalog zuletzt aktualisiert",
    performanceChecked: "Spielplan geprüft",
    dates: "Termine nicht veröffentlicht",
    place: "Festivalort",
    timetable: "Kein geprüfter Spielplan in dieser Kopie",
    cancelled: "Abgesagt",
    empty: "Auf diesem Gerät wurden keine Reisedetails gespeichert.",
  },
  ru: {
    heading: "Данные поездки офлайн",
    save: "Сохранить поездку офлайн",
    update: "Обновить офлайн-копию",
    remove: "Удалить офлайн-копию",
    open: "Открыть поездки офлайн",
    saved: "Данные поездки сохранены на этом устройстве.",
    removed: "Офлайн-копия удалена.",
    pending: "Загрузка…",
    unavailable: "Не удалось загрузить поездку. Прежняя копия, если она есть, сохранена.",
    storage:
      "Не удалось изменить офлайн-копию. Проверьте хранилище браузера или удалите старую поездку.",
    stale: "Офлайн-копия. После подключения проверьте даты, проезд и время выступлений.",
    savedAt: "Загружено",
    checkedAt: "Каталог обновлён",
    performanceChecked: "Расписание проверено",
    dates: "Даты не опубликованы",
    place: "Место фестиваля",
    timetable: "В этой копии нет проверенного расписания",
    cancelled: "Отменено",
    empty: "На этом устройстве нет сохранённых поездок.",
  },
};

export async function fetchOfflineTrip(basePath, slug, year) {
  const response = await fetch(
    `${basePath}/api/offline/trips/${encodeURIComponent(slug)}/${year}/`,
    {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (
    response.status !== 200 ||
    !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")
  ) {
    throw new Error("Trip download unavailable");
  }
  const trip = parseOfflineTrip(await response.json());
  if (!trip || trip.slug !== slug || trip.year !== year)
    throw new Error("Unexpected trip download");
  return trip;
}

export function offlineTripKey(slug, year) {
  return `${prefix}${slug}:${year}`;
}

// Both the application and the offline shell consume this exact public projection.
export function parseOfflineTrip(value) {
  if (
    !value ||
    value.version !== 1 ||
    typeof value.slug !== "string" ||
    !/^[a-z0-9-]{1,160}$/.test(value.slug) ||
    !Number.isInteger(value.year) ||
    value.year < 2000 ||
    value.year > 2100 ||
    !shortText(value.name) ||
    !(value.startDate === null || isoDate(value.startDate)) ||
    !(value.endDate === null || isoDate(value.endDate)) ||
    !(value.location === null || shortText(value.location)) ||
    !instant(value.updatedAt) ||
    !Array.isArray(value.timetable) ||
    value.timetable.length > 800
  )
    return null;
  const timetable = [];
  for (const row of value.timetable) {
    if (
      !row ||
      !isoDate(row.date) ||
      typeof row.start !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.start) ||
      !shortText(row.stage) ||
      !shortText(row.artist) ||
      !shortText(row.timeZone) ||
      !instant(row.checkedAt) ||
      !["scheduled", "cancelled"].includes(row.status)
    )
      return null;
    if (
      (value.startDate && row.date < value.startDate) ||
      (value.endDate && row.date > value.endDate)
    )
      continue;
    timetable.push({
      date: row.date,
      start: row.start,
      stage: row.stage,
      artist: row.artist,
      timeZone: row.timeZone,
      status: row.status,
      checkedAt: row.checkedAt,
    });
  }
  return {
    version: 1,
    slug: value.slug,
    year: value.year,
    name: value.name,
    startDate: value.startDate,
    endDate: value.endDate,
    location: value.location,
    updatedAt: value.updatedAt,
    timetable,
  };
}

function readStored(storage, key) {
  const raw = storage.getItem(key);
  if (!raw || raw.length > maximumBytes) return null;
  try {
    const record = JSON.parse(raw);
    const trip = parseOfflineTrip(record.trip);
    return trip && instant(record.savedAt) && key === offlineTripKey(trip.slug, trip.year)
      ? { trip, savedAt: record.savedAt }
      : null;
  } catch {
    return null;
  }
}

export function readOfflineTrip(storage, slug, year) {
  return readStored(storage, offlineTripKey(slug, year));
}

export function saveOfflineTrip(storage, value, savedAt = new Date().toISOString()) {
  const trip = parseOfflineTrip(value);
  if (!trip || !instant(savedAt)) throw new Error("Invalid trip download");
  const record = { trip, savedAt };
  const serialized = JSON.stringify(record);
  if (new TextEncoder().encode(serialized).length > maximumBytes)
    throw new Error("Trip download too large");
  storage.setItem(offlineTripKey(trip.slug, trip.year), serialized);
  return record;
}

export function listOfflineTrips(storage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  return keys
    .filter((key) => key?.startsWith(prefix))
    .map((key) => readStored(storage, key))
    .filter(Boolean)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
