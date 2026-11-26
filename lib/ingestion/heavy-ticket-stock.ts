import { z } from "zod";
import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";
export const HEAVY_STOCK_DOCUMENTS = "heavy-public-initial-render-v1";
// Keep the reviewed public route fixed; event/rate observations come from the response.
export const HEAVY_WIDGET = "734dcd1a-6e7c-4465-b353-3bd5dcddd20b";
const eventId = 2166331;
const edition = 2027;
const eventName = `HEAVY WEEK-END ${edition}`;
export const HEAVY_WIDGET_API = `https://api.weezevent.com/ticket/widgets/${HEAVY_WIDGET}`;
export const HEAVY_STOCK =
  `https://www.weezevent.com/widget_billeterie.php?id_evenement=${eventId}` +
  `&widget_key=${HEAVY_WIDGET}&locale=en_GB&color_primary=000000`;
export const HEAVY_PURCHASE = `https://widget.weezevent.com/ticket/${HEAVY_WIDGET}?locale=fr-fr`;

export function isHeavyStockSource(source: FestivalSource): boolean {
  return (
    source.festivalSlug === "heavy-weekend" &&
    source.url === "https://www.heavyweekend.live/" &&
    source.editionYear === edition &&
    source.strategies.includes("official_markup") &&
    !source.fetchUrl &&
    !source.followLinkPattern &&
    !source.strategies.includes("manual_review")
  );
}

const timestamp = z.iso.datetime({ offset: true });
const day = z.iso.date();
const isCurrentStart = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith(`${edition}-`) &&
  timestamp.safeParse(value).success;
const ordinaryLabel = "3-DAY PASS - STANDARD - FREE SEATING/STANDING";
const text = (s: string) => s.replace(/\s+/g, " ").trim();

/** Validate the public initial-render action before forwarding its unchanged
 * provider-issued token. This never constructs a token or selects a ticket. */
export function heavyRenderAction(data: any): {
  token: string;
  meta: {
    widget: string;
    eventId: number;
    name: string;
    status: string;
    startDate: string;
    currency: string;
  };
} {
  const fail = () => {
    throw new Error("Heavy public initial-render contract or event identity changed");
  };
  if (
    data?.widget_key !== HEAVY_WIDGET ||
    !Array.isArray(data.widget_events) ||
    data.widget_events.length > 10
  )
    return fail();
  const widgets = data.widget_events.filter((w: any) => w?.widget_event_key === HEAVY_WIDGET);
  const event = widgets[0]?.event;
  if (
    widgets.length !== 1 ||
    event?.id !== eventId ||
    event.name !== eventName ||
    event.status !== "published" ||
    event.publication_status !== "published" ||
    event.time_status !== "upcoming" ||
    event.currency !== "EUR" ||
    !isCurrentStart(event.start_date) ||
    event.sale_start_date !== null ||
    event.sale_end_date !== null
  )
    return fail();
  const step = data.first_step,
    actions = step?.data?.actions;
  if (
    step?.slug !== "4-redirect" ||
    step.is_final !== true ||
    !Array.isArray(actions) ||
    actions.length !== 1 ||
    actions[0]?.action !== "form" ||
    !Array.isArray(actions[0].args) ||
    actions[0].args.length !== 1
  )
    return fail();
  const action = actions[0].args[0],
    q = action?.query;
  if (
    action?.url !== "https://www.weezevent.com/widget_billeterie.php" ||
    !q ||
    Object.keys(q).sort().join() !== "color_primary,id_evenement,locale,widget_key" ||
    String(q.id_evenement) !== String(eventId) ||
    q.widget_key !== HEAVY_WIDGET ||
    q.locale !== "en_GB" ||
    q.color_primary !== "000000" ||
    !action.parameters ||
    Object.keys(action.parameters).join() !== "token"
  )
    return fail();
  const token = action.parameters.token;
  if (
    typeof token !== "string" ||
    token.length > 5000 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  )
    return fail();
  let claims;
  try {
    claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return fail();
  }
  // HTTPS API is the issuer/trust boundary. Never alter/sign the token. Claims
  // only bind this anonymous public render to the reviewed event and no inputs.
  const keys = [
    "iat",
    "nbf",
    "exp",
    "iss",
    "sub",
    "rank",
    "access",
    "event_id",
    "widget_key",
    "widget_data",
  ]
    .sort()
    .join();
  if (
    !claims ||
    Object.keys(claims).sort().join() !== keys ||
    claims.event_id !== eventId ||
    claims.widget_key !== HEAVY_WIDGET ||
    claims.rank !== 1 ||
    claims.access !== true ||
    !claims.widget_data ||
    typeof claims.widget_data !== "object" ||
    Array.isArray(claims.widget_data) ||
    Object.keys(claims.widget_data).length ||
    !Number.isFinite(claims.exp) ||
    !Number.isFinite(claims.nbf) ||
    !Number.isFinite(claims.iat) ||
    claims.exp <= Date.now() / 1000 ||
    claims.nbf > Date.now() / 1000 + 5 ||
    claims.iat > Date.now() / 1000 + 5
  )
    return fail();
  return {
    token,
    meta: {
      widget: HEAVY_WIDGET,
      eventId: event.id,
      name: event.name,
      status: event.status,
      startDate: event.start_date,
      currency: event.currency,
    },
  };
}

// Bind the ordinary rate to its actual category hierarchy, not seeded IDs.
function ordinaryNodes($: ReturnType<typeof load>) {
  const category = $(".billetterie_tb_titre_categorie").filter(
    (_, el) => text($(el).text()) === "3-DAY PASS",
  );
  const standard = $(".billetterie_tb_titre_sous_categorie").filter(
    (_, el) => text($(el).text()) === "STANDARD - SEATED / STANDING",
  );
  const rows = $("table.ticket_table tr").filter(
    (_, el) => text($(el).find(".billetterie_tb_nom").text()) === ordinaryLabel,
  );
  const table = rows.closest("table.ticket_table");
  const categoryId = category.attr("data-id"),
    standardId = standard.attr("data-id"),
    rateId = rows.attr("data-id");
  if (
    category.length !== 1 ||
    standard.length !== 1 ||
    table.length !== 1 ||
    rows.length !== 1 ||
    ![categoryId, standardId, rateId].every((id) => id && /^[1-9]\d{0,11}$/.test(id)) ||
    !standard.hasClass(`p_${categoryId}`) ||
    !table.hasClass(`p_${standardId}`) ||
    table.attr("id") !== `ticket_table_${rateId}`
  )
    throw new Error("Heavy ordinary stock table/category missing or duplicated");
  return { category, standard, table, row: rows, rateId };
}

/** Reduce before persistence: keep actual provider DOM, not form/session/token,
 * customer or unrelated-category data. Preserve visibility and disabled state. */
export function reduceHeavyStockDocument(body: string): string {
  const $ = load(body);
  const { category: dayHeader, standard: standardHeader, table } = ordinaryNodes($);
  const blocked =
    "[hidden],[inert],[aria-hidden='true'],[disabled],[aria-disabled='true'],.disabled,.hidden,.is--hidden,.d-none";
  for (const el of [table, dayHeader, standardHeader]) {
    if (
      el.is(blocked) ||
      el.parents(blocked).length ||
      el
        .add(el.parents())
        .toArray()
        .some((e) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr("style") ?? ""))
    )
      throw new Error("Heavy ordinary stock table/category is hidden");
  }
  const nodes = [dayHeader.clone(), standardHeader.clone(), table.clone()];
  const allowed = new Set([
    "id",
    "class",
    "data-id",
    "data-value",
    "data-ticket_id",
    "data-prix",
    "data-prix-affiche",
    "name",
    "value",
    "disabled",
    "hidden",
    "inert",
    "aria-disabled",
    "aria-hidden",
    "selected",
    "style",
  ]);
  for (const root of nodes) {
    root.find("script,style,input,form,iframe,template,noscript,a,img,svg").remove();
    for (const e of root.find("*").add(root).toArray())
      for (const attr of Object.keys("attribs" in e ? e.attribs : {}))
        if (!allowed.has(attr)) $(e).removeAttr(attr);
  }
  return nodes.map((n) => $.html(n)).join("\n");
}

export function observeHeavyStock(
  body: string,
  dates?: Pick<FestivalCandidate, "startDate" | "endDate">,
): TicketObservation {
  const fail = (reason: string): TicketObservation => ({
    excerpt: "",
    warning: `Official heavy-weekend ticket source requires review: ${reason}`,
  });
  let doc;
  try {
    doc = JSON.parse(body);
  } catch {
    return fail("public render envelope invalid");
  }
  const m = doc?.meta;
  const primary = z.object({ startDate: day, endDate: day }).safeParse(dates);
  if (
    doc?.kind !== HEAVY_STOCK_DOCUMENTS ||
    doc.apiUrl !== HEAVY_WIDGET_API ||
    doc.renderUrl !== HEAVY_STOCK ||
    typeof doc.html !== "string" ||
    m?.widget !== HEAVY_WIDGET ||
    m.eventId !== eventId ||
    m.name !== eventName ||
    m.status !== "published" ||
    !isCurrentStart(m.startDate) ||
    m.currency !== "EUR" ||
    !primary.success ||
    m.startDate.slice(0, 10) !== primary.data.startDate ||
    Date.parse(primary.data.endDate) - Date.parse(primary.data.startDate) !== 2 * 86_400_000
  )
    return fail("current event/source/primary dates changed");
  let reduced;
  try {
    reduced = reduceHeavyStockDocument(doc.html);
  } catch {
    return fail("ordinary rate/category hidden or ambiguous");
  }
  const $ = load(reduced);
  $(
    "script,style,template,[hidden],[inert],[aria-hidden='true'],.hidden,.is--hidden,.d-none",
  ).remove();
  $("[style]").each((_, e) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr("style") ?? "")) $(e).remove();
  });
  let ordinary;
  try {
    ordinary = ordinaryNodes($);
  } catch {
    return fail("ordinary rate/category hidden or ambiguous");
  }
  const { table, row, rateId } = ordinary;
  const select = row.find(`select#quantite_${rateId}[name='quantite_${rateId}']`),
    price = row.find(".billetterie_tb_prix .globalize[data-value]");
  const one = select.find("option[value='1']");
  const blocked =
    "[disabled],[aria-disabled='true'],[hidden],[inert],.disabled,.hidden,.is--hidden,.d-none";
  if (
    select.length !== 1 ||
    select.attr("data-ticket_id") !== String(rateId) ||
    select.val() !== "0" ||
    one.length !== 1 ||
    [table, row, select, one].some((e) => e.is(blocked) || e.parents(blocked).length) ||
    price.length !== 1 ||
    !/^\d+(?:\.\d+)?$/.test(price.attr("data-value") ?? "") ||
    !Number.isFinite(Number(price.attr("data-value"))) ||
    Number(price.attr("data-value")) <= 0 ||
    select.attr("data-prix") !== price.attr("data-value") ||
    select.attr("data-prix-affiche") !== price.attr("data-value") ||
    !/^€\d+(?:\.\d{2})?$/.test(text(price.text())) ||
    Number(text(price.text()).slice(1)) !== Number(price.attr("data-value")) ||
    /sold\s*out|unavailable|closed|complet|épuisé/i.test(text(row.text()))
  )
    return fail("ordinary unrestricted rate stock/quantity/price unavailable or conflicting");
  return {
    status: "available",
    ticketsUrl: HEAVY_PURCHASE,
    excerpt:
      `${eventName}; ordinary 3-DAY PASS STANDARD; event ${eventId}/rate ${rateId}; ` +
      `EUR ${price.attr("data-value")}; public initial render has enabled unselected quantity with option1; ` +
      "no ticket selected or reserved",
  };
}

// Only the initial public document is returned. Issued tokens and hidden form
// state are excluded from the normalized source envelope.
export async function fetchHeavyStockDocument({
  fetchWithRetry,
  fetchOnce,
  readText,
}: {
  fetchWithRetry: (url: string, headers: Record<string, string>) => Promise<Response>;
  fetchOnce: (url: string, init: RequestInit) => Promise<Response>;
  readText: (response: Response) => Promise<string>;
}): Promise<{ response: Response } | { html: string }> {
  const meta = await fetchWithRetry(HEAVY_WIDGET_API, {
    accept: "application/json",
    "accept-language": "en-GB",
  });
  if (!meta.ok) return { response: meta };
  if (meta.url && meta.url !== HEAVY_WIDGET_API)
    throw new Error("Heavy public widget metadata redirected");
  if (!/^application\/json\b/i.test(meta.headers.get("content-type") ?? ""))
    throw new Error("Heavy public widget metadata media type changed");
  const action = heavyRenderAction(JSON.parse(await readText(meta)));
  // One read-only document-render POST, no blind retry. Never forward the
  // primary's authorization/cookies or follow a token-bearing redirect.
  const render = await fetchOnce(HEAVY_STOCK, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "LoudWeekendBot/1.1 (+https://loudweekend.eu/; public festival-data monitor)",
    },
    body: new URLSearchParams({ token: action.token }).toString(),
  });
  if (!render.ok) return { response: render };
  if (render.url && render.url !== HEAVY_STOCK)
    throw new Error("Heavy public initial render redirected");
  if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(render.headers.get("content-type") ?? ""))
    throw new Error("Heavy public initial render media type changed");
  const html = JSON.stringify({
    kind: HEAVY_STOCK_DOCUMENTS,
    apiUrl: HEAVY_WIDGET_API,
    renderUrl: HEAVY_STOCK,
    meta: action.meta,
    html: reduceHeavyStockDocument(await readText(render)),
  });
  return { html };
}
