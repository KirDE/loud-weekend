import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";
import { validateGenericLineup } from "../lineup-quality.ts";
import { festivalDateInterval } from "../../festival-dates.ts";

type JsonLd = Record<string, unknown>;

function records(value: unknown): JsonLd[] {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!value || typeof value !== "object") return [];
  const record = value as JsonLd;
  return [record, ...records(record["@graph"])];
}

function eventId(record: JsonLd, sourceUrl: string): string | undefined {
  const id = record["@id"];
  if (typeof id !== "string" || !id.trim()) return undefined;
  // Blank-node IDs are not relative URLs.
  if (id.startsWith("_:")) return id;
  try {
    return new URL(id, sourceUrl).href;
  } catch {
    return undefined;
  }
}

function eventRecords(html: string, sourceUrl: string) {
  const events: JsonLd[] = [];
  const splitRelations: JsonLd[] = [];
  const reviewStatuses = new Map<string, string>();
  const $ = load(html);
  $("template").remove();
  for (const element of $("script[type]").toArray()) {
    const script = $(element);
    if (script.attr("type")?.trim().toLowerCase() !== "application/ld+json") continue;
    const source = script.text().trim();
    if (!source) continue;
    try {
      const parsed = JSON.parse(source);
      for (const record of records(parsed)) {
        if (record.eventStatus != null) {
          const id = eventId(record, sourceUrl);
          const status = eventStatusRequiringReview(record.eventStatus);
          // A named node can have separate descriptions. Do not join blank nodes across scripts.
          if (id && !id.startsWith("_:") && status) reviewStatuses.set(id, status);
        }
        const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
        if (
          types.some((type) => typeof type === "string" && type.toLowerCase().endsWith("event"))
        ) {
          events.push(record);
        } else if (record.superEvent != null || record.subEvent != null) {
          splitRelations.push(record);
        }
      }
    } catch {
      continue;
    }
  }
  // Named events can have separate descriptions containing only their relationships.
  const eventIds = new Set(events.map((event) => eventId(event, sourceUrl)));
  const linkedDescriptions = splitRelations.filter((record) => {
    const id = eventId(record, sourceUrl);
    return id && !id.startsWith("_:") && eventIds.has(id);
  });
  const childIds = new Set<string>();
  for (const event of [...events, ...linkedDescriptions]) {
    const parentId = eventId(event, sourceUrl);
    if (parentId && !parentId.startsWith("_:") && event.superEvent != null) childIds.add(parentId);
    for (const child of records(event.subEvent)) {
      const childId = eventId(child, sourceUrl);
      if (childId && childId !== parentId) childIds.add(childId);
    }
  }
  return {
    events: events
      .filter((event) => {
        const id = eventId(event, sourceUrl);
        return event.superEvent == null && (!id || !childIds.has(id));
      })
      .map((event) => ({ event, excerpt: JSON.stringify(event).slice(0, 500) })),
    reviewStatuses,
  };
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object" && typeof (value as JsonLd).name === "string")
    return ((value as JsonLd).name as string).trim() || undefined;
  return undefined;
}

function eventStatusRequiringReview(value: unknown): string | undefined {
  const statuses = Array.isArray(value) ? value : [value];
  return statuses
    .map((status) => text((status as JsonLd | null | undefined)?.["@id"]) ?? text(status))
    .find((status) => status && /cancelled|postponed|rescheduled|movedonline/i.test(status));
}

function eventDate(value: unknown): { day: string; instant?: number } | undefined {
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
  const { events: parsedEvents, reviewStatuses } = eventRecords(html, source.url);
  const events = parsedEvents.map((record) => ({
    ...record,
    startDate: eventDate(record.event.startDate),
    endDate: eventDate(record.event.endDate),
  }));
  const matches = events.filter(({ startDate, endDate }) => {
    if (!startDate || !endDate) return true;
    if (!festivalDateInterval({ startDate: startDate.day, endDate: endDate.day })) return false;
    return (
      startDate.instant === undefined ||
      endDate.instant === undefined ||
      endDate.instant >= startDate.instant
    );
  });
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

  if (matches.length !== events.length)
    candidate.warnings.push("JSON-LD Event end date precedes its start date");
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
  if (selected.event.startDate != null && fields.startDate === undefined)
    candidate.warnings.push("JSON-LD Event contains an invalid start date");
  if (selected.event.endDate != null && fields.endDate === undefined)
    candidate.warnings.push("JSON-LD Event contains an invalid end date");
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

  const selectedId = eventId(selected.event, source.url);
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
