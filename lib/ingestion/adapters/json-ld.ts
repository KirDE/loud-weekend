import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";
import { validateGenericLineup } from "../lineup-quality.ts";
import { festivalDateInterval } from "../../festival-dates.ts";

type JsonLd = Record<string, unknown>;
type ScriptRecord = { record: JsonLd; scriptIndex: number };

function records(value: unknown): JsonLd[] {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!value || typeof value !== "object") return [];
  const record = value as JsonLd;
  return [record, ...records(record["@graph"])];
}

function setMembers(value: unknown): unknown[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((member) => {
    if (!member || typeof member !== "object" || !Object.hasOwn(member, "@set")) return [member];
    const members = (member as JsonLd)["@set"];
    return Array.isArray(members) ? members : [members];
  });
}

function* documentRecords(value: unknown): Generator<JsonLd> {
  for (const record of records(value)) {
    yield record;
    // Included nodes are document-level descriptions, not timetable entries.
    yield* documentRecords(record["@included"]);
  }
}

function eventKey(record: JsonLd, sourceUrl: string, scriptIndex: number): string | undefined {
  const id = record["@id"];
  if (typeof id !== "string" || !id.trim()) return undefined;
  // Named IDs can link across scripts; blank-node labels belong to one script.
  if (id.startsWith("_:")) return `${scriptIndex}:${id}`;
  try {
    return new URL(id, sourceUrl).href;
  } catch {
    return undefined;
  }
}

function eventRecords(html: string, sourceUrl: string) {
  const events: ScriptRecord[] = [];
  const splitRelations: ScriptRecord[] = [];
  const reviewStatuses = new Map<string, string>();
  const dateDescriptions = new Map<string, JsonLd[]>();
  const $ = load(html);
  $("template").remove();
  for (const [scriptIndex, element] of $("script[type]").toArray().entries()) {
    const script = $(element);
    if (script.attr("type")?.trim().toLowerCase() !== "application/ld+json") continue;
    const source = script.text().trim();
    if (!source) continue;
    try {
      const parsed = JSON.parse(source);
      for (const record of documentRecords(parsed)) {
        const id = eventKey(record, sourceUrl, scriptIndex);
        if (id) {
          const status = eventStatusRequiringReview(record.eventStatus);
          if (status) reviewStatuses.set(id, status);
          if (record.startDate != null || record.endDate != null) {
            const descriptions = dateDescriptions.get(id);
            if (descriptions) descriptions.push(record);
            else dateDescriptions.set(id, [record]);
          }
        }
        const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
        if (
          types.some(
            (type) =>
              typeof type === "string" &&
              (type.toLowerCase().endsWith("event") ||
                /^(?:https?:\/\/schema\.org\/)?Festival$/i.test(type)),
          )
        ) {
          events.push({ record, scriptIndex });
        } else if (record.superEvent != null || record.subEvent != null) {
          splitRelations.push({ record, scriptIndex });
        }
      }
    } catch {
      continue;
    }
  }
  // Bind relationship-only descriptions to known events using the same identity as their claims.
  const eventIds = new Set(
    events.map(({ record, scriptIndex }) => eventKey(record, sourceUrl, scriptIndex)),
  );
  const linkedDescriptions = splitRelations.filter(({ record, scriptIndex }) => {
    const id = eventKey(record, sourceUrl, scriptIndex);
    return id && eventIds.has(id);
  });
  const childIds = new Set<string>();
  for (const { record, scriptIndex } of [...events, ...linkedDescriptions]) {
    const parentId = eventKey(record, sourceUrl, scriptIndex);
    if (parentId && record.superEvent != null) childIds.add(parentId);
    for (const child of setMembers(record.subEvent).flatMap(records)) {
      const childId = eventKey(child, sourceUrl, scriptIndex);
      if (childId && childId !== parentId) childIds.add(childId);
    }
  }
  return {
    events: events
      .filter(({ record, scriptIndex }) => {
        const id = eventKey(record, sourceUrl, scriptIndex);
        return record.superEvent == null && (!id || !childIds.has(id));
      })
      .map(({ record, scriptIndex }) => ({
        event: record,
        id: eventKey(record, sourceUrl, scriptIndex),
        excerpt: JSON.stringify(record).slice(0, 500),
      })),
    reviewStatuses,
    dateDescriptions,
  };
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object" && typeof (value as JsonLd).name === "string")
    return ((value as JsonLd).name as string).trim() || undefined;
  return undefined;
}

function eventStatusRequiringReview(value: unknown): string | undefined {
  return setMembers(value)
    .map((status) => {
      const record = status as JsonLd | null | undefined;
      const literal = record?.["@value"];
      return text(record?.["@id"]) ?? text(typeof literal === "string" ? literal : status);
    })
    .find((status) => status && /cancelled|postponed|rescheduled|movedonline/i.test(status));
}

type EventDate = { day: string; instant?: number };

function eventDate(value: unknown): EventDate | undefined {
  if (typeof value !== "string") return undefined;
  const valueText = value.trim();
  const plainDate = valueText.match(
    /^(\d{4}-\d{2}-\d{2})(?:[Tt ](?:[01]\d|2[0-3]):\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/,
  )?.[1];
  const parsed = Date.parse(valueText);
  if (!plainDate || !festivalDateInterval({ startDate: plainDate }) || !Number.isFinite(parsed)) {
    return undefined;
  }
  // Use the local date in the official timestamp, not its UTC day.
  const hasOffset =
    valueText.length > plainDate.length && /(?:z|[+-]\d{2}:?\d{2})$/i.test(valueText);
  return { day: plainDate, instant: hasOffset ? parsed : undefined };
}

function isReversed(start?: EventDate, end?: EventDate): boolean {
  if (!start || !end) return false;
  return (
    !festivalDateInterval({ startDate: start.day, endDate: end.day }) ||
    (start.instant !== undefined && end.instant !== undefined && end.instant < start.instant)
  );
}

const reversedDateWarning = "JSON-LD Event end date precedes its start date";

function city(location: unknown): string | undefined {
  if (!location || typeof location !== "object") return undefined;
  const address = (location as JsonLd).address;
  if (typeof address === "string") return undefined;
  if (address && typeof address === "object") return text((address as JsonLd).addressLocality);
  return undefined;
}

function names(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const result = [...new Set(values.map(text).filter((name): name is string => Boolean(name)))];
  return result.length > 0 ? result : undefined;
}

function ticketUrl(offers: unknown): string | undefined {
  const values = Array.isArray(offers) ? offers : [offers];
  for (const offer of values) {
    if (typeof offer === "string" && offer.startsWith("https://")) return offer;
    if (offer && typeof offer === "object") {
      const url = text((offer as JsonLd).url);
      if (url && url.startsWith("https://")) return url;
    }
  }
  return undefined;
}

function ticketStatus(offers: unknown): FestivalCandidate["ticketStatus"] {
  const values = Array.isArray(offers) ? offers : [offers];
  const availability = values.map((offer) => {
    const value =
      offer && typeof offer === "object" ? text((offer as JsonLd).availability) : undefined;
    return value
      ?.match(
        /^(?:https?:\/\/schema\.org\/)?(SoldOut|OutOfStock|LimitedAvailability|InStock|PreOrder|PreSale)$/i,
      )?.[1]
      .toLowerCase();
  });
  // A sold-out tier does not mean the whole event is sold out. Positive offers
  // take precedence; only an explicit complete set of sellouts proves sellout.
  if (availability.some((value) => ["instock", "preorder", "presale"].includes(value ?? "")))
    return "available";
  if (availability.includes("limitedavailability")) return "low";
  if (availability.length && availability.every((value) => value === "soldout")) return "sold_out";
  if (
    availability.length &&
    availability.every((value) => value === "soldout" || value === "outofstock")
  )
    return "unavailable";
  return undefined;
}

function timetable(value: unknown): FestivalCandidate["timetable"] {
  const result = records(value).flatMap((entry) => {
    const artist = text(entry.performer) || text(entry.name);
    const startDate = text(entry.startDate);
    if (!artist || !startDate) return [];
    const parsed = new Date(startDate);
    if (Number.isNaN(parsed.valueOf())) return [];
    return [
      {
        date: parsed.toISOString().slice(0, 10),
        start: parsed.toISOString().slice(11, 16),
        stage: text(entry.location) || "TBA",
        artist,
      },
    ];
  });
  return result.length ? result : undefined;
}

export function extractJsonLdCandidate(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
): FestivalCandidate {
  const { events: parsedEvents, reviewStatuses, dateDescriptions } = eventRecords(html, source.url);
  const events = parsedEvents.map((record) => ({
    ...record,
    startDate: eventDate(record.event.startDate),
    endDate: eventDate(record.event.endDate),
  }));
  const matches = events.filter(({ startDate, endDate }) => !isReversed(startDate, endDate));
  const matching = matches.filter(({ startDate }) =>
    startDate?.day.startsWith(`${source.editionYear}-`),
  );
  const selected = matching[0] ?? matches[0];
  const candidate: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
    observedEditionYears: [],
  };

  if (matches.length !== events.length) candidate.warnings.push(reversedDateWarning);
  if (!selected) {
    if (!events.length) candidate.warnings.push("No JSON-LD Event was found");
    return candidate;
  }

  const fields = {
    startDate: selected.startDate?.day,
    endDate: selected.endDate?.day,
    city: city(selected.event.location),
    lineup: names(selected.event.performer),
    ticketsUrl: ticketUrl(selected.event.offers),
    ticketStatus: ticketStatus(selected.event.offers),
    timetable: timetable(selected.event.subEvent),
  };
  const selectedId = selected.id;
  const descriptions = (selectedId && dateDescriptions.get(selectedId)) || [selected.event];
  const claimedDates = descriptions.map(({ startDate, endDate }) => ({
    startDate: eventDate(startDate),
    endDate: eventDate(endDate),
  }));
  // Alternate claims can block publication but cannot supply the chosen fields or evidence.
  const [latestStart, earliestEnd] = (
    [
      ["startDate", "start date"],
      ["endDate", "end date"],
    ] as const
  ).map(([field, label]) => {
    const days = new Set<string>();
    let instant: number | undefined;
    let invalid = false;
    for (const [index, dates] of claimedDates.entries()) {
      const date = dates[field];
      if (date) {
        days.add(date.day);
        if (date.instant !== undefined) {
          // Compare the latest start with the earliest end without pairing every description.
          const extreme = field === "startDate" ? Math.max : Math.min;
          instant = instant === undefined ? date.instant : extreme(instant, date.instant);
        }
      } else if (descriptions[index][field] != null) {
        invalid = true;
      }
    }
    if (invalid) candidate.warnings.push(`JSON-LD Event contains an invalid ${label}`);
    if (days.size > 1) candidate.warnings.push(`Conflicting JSON-LD festival ${field} claims`);
    const day = days.size === 1 ? days.values().next().value : undefined;
    return day ? { day, instant } : undefined;
  });
  if (
    matches.length === events.length &&
    (isReversed(latestStart, earliestEnd) ||
      claimedDates.some(({ startDate, endDate }) => isReversed(startDate, endDate)))
  ) {
    candidate.warnings.push(reversedDateWarning);
  }
  const lineupQuality = validateGenericLineup(fields.lineup ?? []);
  fields.lineup = lineupQuality.names.length
    ? lineupQuality.names
    : fields.lineup === undefined
      ? undefined
      : [];
  candidate.warnings.push(...lineupQuality.warnings);
  const observedYear = Number(fields.startDate?.slice(0, 4));
  if (Number.isFinite(observedYear)) candidate.observedEditionYears.push(observedYear);
  if (matches.length && matching.length === 0 && candidate.observedEditionYears.length) {
    candidate.warnings.push(
      "JSON-LD event edition " +
        `${candidate.observedEditionYears[0]}` +
        " does not match catalogue edition " +
        `${source.editionYear}`,
    );
  }

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    Object.assign(candidate, { [field]: value });
    const evidenceField = field as FieldEvidence["field"];
    candidate.evidence.push({
      field: evidenceField,
      sourceUrl: source.url,
      observedAt: fetchedAt,
      excerpt: selected.excerpt,
    });
    // Keep the parsed values for diagnostics but do not treat document order
    // as proof that this Event belongs to the selected festival edition.
    if (matching.length > 1 && evidenceField !== "timetable") {
      (candidate.fieldEditionYears ??= {})[evidenceField] = [];
    }
  }

  const reviewStatus =
    eventStatusRequiringReview(selected.event.eventStatus) ??
    (selectedId ? reviewStatuses.get(selectedId) : undefined);
  if (reviewStatus)
    candidate.warnings.push(`Official event status requires review: ${reviewStatus}`);
  if (matching.length > 1)
    candidate.warnings.push(
      "Multiple JSON-LD Events match catalogue edition " +
        `${source.editionYear}` +
        " (" +
        `${matching.length}` +
        "); the first matching event was selected",
    );
  if (candidate.evidence.length === 0)
    candidate.warnings.push("JSON-LD Event did not contain supported festival fields");
  return candidate;
}
