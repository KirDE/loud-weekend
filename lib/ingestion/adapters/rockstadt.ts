import { load } from "cheerio";
import type { FestivalSource } from "../types.ts";

const url = "https://bilete.rockstadtextremefest.ro/bilete-rockstadt-fest-2027-129242/";
const title = "Rockstadt Fest 2027";
const text = (value: string) =>
  value
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
const attr = (tag: string, name: string) =>
  tag
    .match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))
    ?.slice(1)
    .find((value) => value !== undefined);
const hasClass = (tag: string, name: string) =>
  attr(tag, "class")?.split(/\s+/).includes(name) ?? false;

// Require a unique, closed div. Nested divs must close before its own closing
// tag; a truncated details/box cannot borrow an unrelated following block.
function div(html: string, matches: (tag: string) => boolean): string | undefined {
  const openings = [...html.matchAll(/<div\b[^<>]*>/gi)].filter((match) => matches(match[0]));
  if (openings.length !== 1) return undefined;
  const opening = openings[0];
  const start = opening.index! + opening[0].length;
  let depth = 1;
  for (const tag of html.slice(start).matchAll(/<\/?div\b[^<>]*>/gi)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index!);
  }
  return undefined;
}

export function rockstadt(html: string, source: FestivalSource) {
  if (source.url !== url || source.editionYear !== 2027) return undefined;
  // This is an edition-bound ticket article, never a homepage or generic Event
  // JSON-LD parser. Require a complete document and independently matching OG.
  if (!/<\/body>\s*<\/html>\s*$/i.test(html)) return undefined;
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const head = clean
    .match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!head) return undefined;
  const expected: Record<string, string> = {
    "og:url": url,
    "og:type": "article",
    "og:title": title,
  };
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  for (const [property, value] of Object.entries(expected)) {
    const tags = metas.filter((tag) => attr(tag, "property") === property);
    if (tags.length !== 1 || attr(tags[0], "content") !== value) return undefined;
  }
  const descriptions = metas.filter((tag) => attr(tag, "property") === "og:description");
  if (
    descriptions.length > 1 ||
    descriptions.some(
      (tag) =>
        text(attr(tag, "content") ?? "") !== "26-30 iul '27, Rockstadt Fest, Ghimbav (Brașov)",
    )
  )
    return undefined;
  const titles = [...head.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)];
  if (
    titles.length > 1 ||
    titles.some(
      (match) => text(match[1]) !== "Bilete Rockstadt Fest 2027 - 26-30 iul '27 - Rockstadt Fest",
    )
  )
    return undefined;
  const canonicals = [...head.matchAll(/<link\b[^>]*>/gi)].filter(
    (match) => attr(match[0], "rel") === "canonical",
  );
  if (canonicals.length > 1 || canonicals.some((match) => attr(match[0], "href") !== url))
    return undefined;

  // If the ticket host's event metadata is present, it must corroborate every
  // field. JSON-LD, navigation and footer cannot supply missing article facts.
  const metadata = [...clean.matchAll(/dataLayer\.push\((\{"pageData"[\s\S]*?)\);/g)];
  if ((clean.match(/"pageData"\s*:/g) ?? []).length !== metadata.length || metadata.length > 1)
    return undefined;
  for (const match of metadata) {
    try {
      const { event, venue } = JSON.parse(match[1]).pageData;
      if (
        event.id !== "129242" ||
        event.title !== title ||
        event.start_date !== "2027-07-26" ||
        event.end_date !== "2027-07-30" ||
        venue.name !== "Rockstadt Fest" ||
        venue.town !== "Ghimbav (Brașov)"
      )
        return undefined;
    } catch {
      return undefined;
    }
  }

  const body = clean
    .match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    .replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!body) return undefined;
  let depth = 0;
  for (const tag of body.matchAll(/<\/?div\b[^<>]*>/gi)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth < 0 || /\/\s*>$/.test(tag[0])) return undefined;
  }
  if (depth !== 0) return undefined;
  // The verified heading and details live in sibling boxes of this event
  // column. Keep both anchors in that column, excluding other event cards.
  const box = div(
    body,
    (tag) => hasClass(tag, "col-md-8") && hasClass(tag, "slot") && hasClass(tag, "col-md-push-4"),
  );
  const dateTag = box?.match(
    /^\s*<div class="box">\s*<h1>Rockstadt Fest 2027<\/h1>\s*(<div\b[^>]*>)/i,
  )?.[1];
  if (
    !box ||
    !dateTag ||
    !hasClass(dateTag, "date-location") ||
    (box.match(/<h1\b/gi) ?? []).length !== 1
  )
    return undefined;
  const location = div(box, (tag) => hasClass(tag, "date-location"));
  if (
    !location ||
    !new RegExp(
      "^\\s*<p>\\s*<strong>Rockstadt Fest, Ghimbav \\(Brașov\\)<\\/stron" +
        "g>\\s*<\\/p>\\s*<p>\\s*26-30 iulie (?:'|&#0*39;)27\\s*<\\/p>\\s*$",
      "",
    ).test(location)
  )
    return undefined;
  const details = div(box, (tag) => attr(tag, "id") === "details");
  if (!details) return undefined;
  const description = div(details, (tag) => hasClass(tag, "event-short-desc"));
  if (
    !description ||
    (box.match(/First confirmed names:/gi) ?? []).length !== 1 ||
    (box.match(/\bevent-short-desc\b/g) ?? []).length !== 1
  )
    return undefined;
  // This first-wave article is additive, not a complete billing grid. Extract
  // its actual names so later additions do not depend on a frozen six-act bill.
  // HTML tag names are case-insensitive; the live article also uses <Strong>.
  const announcement = description.match(/First confirmed names:\s*<strong>([^<>]+)<\/strong>/i);
  if (!announcement) return undefined;
  let names = text(announcement[1]).split(/,\s*/);
  if (
    !names.length ||
    names.some((name) => !name || name.length > 160 || !/\p{L}/u.test(name)) ||
    new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length
  )
    return undefined;
  const prose = description.replace(announcement[0], "").replace(/<br\s*\/?\s*>/gi, " ");
  if (
    /[<>]/.test(prose) ||
    /\b(?:cancelled|canceled|withdrawn|full line.?up|complete line.?up|also confirmed)\b/i.test(
      prose,
    ) ||
    [...prose.matchAll(/\b20\d{2}\b/g)].some((match) => match[0] !== String(source.editionYear))
  )
    return undefined;

  // An enabled festival-admission tariff in this event's own live order form
  // proves sales, unlike historical offer JSON-LD, prices or a generic button.
  const $ = load(box);
  $(
    "script, style, template, noscript, nav, footer, [hidden], [inert], [aria-hidden='true'], " +
      "[disabled], [aria-disabled='true']",
  ).remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  // The article can append album-anniversary performance copy to a band name.
  // The Rockstadt announcement identifies Black Metal as a Venom album performance.
  // Require that verified artist/album pair and one visible artist card; an
  // anniversary suffix alone does not establish that the billing is for one act.
  const cardNames = $(".event-artist-heading .event-artist-link")
    .toArray()
    .map((element) => text($(element).text()));
  names = names.map((name) => {
    const performance = name.match(
      /^(Venom)\s+[-–—]\s*Black Metal\s+\(\d+(?:st|nd|rd|th) anniversary\)$/i,
    );
    if (!performance) return name;
    const matches = cardNames.filter(
      (card) => card.toLocaleLowerCase() === performance[1].toLocaleLowerCase(),
    );
    return matches.length === 1 ? matches[0] : name;
  });
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length)
    return undefined;
  const disabled = ".disabled, .sold-out, .unavailable";
  const blocked = (element: ReturnType<typeof $>) =>
    element.is(disabled) || element.parents(disabled).length > 0;
  const widgets = $(".order-form-widget.can-book").filter((_, element) => {
    const w = $(element);
    return (
      w.attr("data-return-url") === url &&
      w.attr("data-is-order-form-widget") === "true" &&
      !blocked(w)
    );
  });
  const forms = widgets.length === 1 ? widgets.find("form") : $("");
  const form = forms.first();
  const formReady =
    forms.length === 1 &&
    form.attr("data-is-order-form") === "true" &&
    form.attr("action") === "https://bilete.rockstadtextremefest.ro/widgetOrderForm/bookEvent/" &&
    form.attr("method")?.toLowerCase() === "post" &&
    form.attr("data-disable-submit") === "0" &&
    !blocked(form);
  const admission =
    formReady &&
    form
      .find("div[data-is-tariff='1']")
      .toArray()
      .some((element) => {
        const tariff = $(element),
          id = tariff.attr("data-tariff-id") ?? "",
          price = Number(tariff.attr("data-tariff-sell-price"));
        // Teen-only/restricted passes are not evidence of purchasable ordinary
        // adult entry. Parking, merch and sibling tariff quantities are excluded.
        if (
          !/^\d+$/.test(id) ||
          !/^Abonament\b.*Acces General/i.test(tariff.attr("data-tariff-name") ?? "") ||
          !Number.isFinite(price) ||
          price <= 0 ||
          tariff.attr("data-tariff-sell-currency") !== "RON" ||
          blocked(tariff)
        )
          return false;
        return tariff
          .find("input[data-is-ticket-nr='1']")
          .toArray()
          .some((element) => {
            const input = $(element),
              max = Number(input.attr("data-max-nr-tickets"));
            return (
              !blocked(input) &&
              input.attr("data-tariff-id") === id &&
              Number.isSafeInteger(max) &&
              max > 0
            );
          });
      });
  const submit =
    formReady &&
    form.find("button[data-is-order-form-submit='true']").filter((_, element) => {
      const button = $(element);
      return (
        !blocked(button) &&
        button.attr("type") === "submit" &&
        text(button.text()) === "Comandă bilete"
      );
    }).length === 1;
  const sale = Boolean(admission && submit);
  return {
    editionYear: 2027,
    startDate: "2027-07-26",
    endDate: "2027-07-30",
    city: "Ghimbav (Brașov)",
    lineup: names,
    artistListMode: "additive" as const,
    status: "partial" as const,
    ...(sale
      ? { ticketsUrl: url, ticketStatus: "available" as const }
      : {
          warning:
            "Rockstadt current ordinary admission inventory requires review; no global sellout inferred",
        }),
    excerpt:
      `${title}; 26-30 iulie '27; Ghimbav (Brașov); First confirmed names: ${text(announcement[1])}` +
      (sale ? "; live festival admission tariff, selectable quantity; Comandă bilete" : ""),
  };
}
