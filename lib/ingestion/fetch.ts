import { alcatrazPrimaryUrl } from "./alcatraz-ticket-stock.ts";
import { validateBarcelonaFetch } from "./adapters/barcelona-banner.ts";
import { RFP_STOCK, reduceRfpStockDocument } from "./rfp-ticket-stock.ts";
import {
  matchesTicketPrimaryUrl,
  ticketSupplementUrl,
  TICKET_SUPPLEMENT,
} from "./ticket-supplements.ts";
import { createHash } from "node:crypto";
import { isFullRewind, FULL_REWIND_BANDS, FULL_REWIND_DOCUMENTS } from "./adapters/full-rewind.ts";
import { isDownloadSource, DOWNLOAD_ARTISTS, DOWNLOAD_DOCUMENTS } from "./adapters/download.ts";
import {
  isHeavyHomepage,
  heavyMissingArtistUrls,
  heavyReviewedLogoUrl,
  HEAVY_DOCUMENTS,
} from "./adapters/heavy-weekend.ts";
import { isRoskildeSource, fetchRoskildeDocuments } from "./adapters/roskilde.ts";
import {
  isImpericonCurrentSource,
  impericonTicketProducts,
  impericonDynamicNewsUrl,
  discoverImpericonAnnouncements,
  sameImpericonArticle,
  impericonArticleUrl,
  IMPERICON_DOCUMENTS,
} from "./adapters/impericon-current.ts";
import {
  isRoadburnSource,
  roadburnUrl,
  roadburnLinked,
  discoverRoadburnAnnouncements,
  roadburnDocuments,
  type RoadburnDocument,
} from "./adapters/roadburn.ts";
import { isPolandrockSource, polandrockAnnouncementUrl } from "./adapters/polandrock.ts";
import { handlesBrutalAssault, fetchBrutalAssaultDocuments } from "./adapters/brutal-assault.ts";
import {
  isCopenhellCurrentSource,
  copenhellUrl,
  copenhellNews,
  copenhellArtistLinks,
  copenhellEnvelope,
  type CopenhellDocument,
} from "./adapters/copenhell-current.ts";
import {
  isLeyendasSource,
  leyendasLinkedRoute,
  leyendasNewsLinks,
  LEYENDAS_ORIGIN,
  LEYENDAS_DOCUMENTS,
} from "./adapters/leyendas.ts";
import {
  isRockInRomaSource,
  rockInRomaConcerts,
  ROCK_IN_ROMA_DOCUMENTS,
  type RockInRomaDocument,
} from "./adapters/rock-in-roma.ts";
import { isAlpenFlairSource, alpenAnnouncements, alpenEnvelope } from "./adapters/alpen-flair.ts";
import { isInfernoSource, isInfernoResponse } from "./adapters/inferno.ts";
import { discoverMotocultorAnnouncement } from "./adapters/motocultor.ts";
import {
  isTuskaHomepage,
  discoverTuskaAnnouncement,
  tuskaTicketsUrl,
  TUSKA_DOCUMENTS,
} from "./adapters/tuska.ts";
import {
  isFrequencySource,
  frequencyTicketLink,
  frequencyDocuments,
} from "./adapters/frequency.ts";
import { isPaleoSource, paleoTicketLink, isPaleoTicketUrl } from "./adapters/paleo.ts";
import { isLeedsSource } from "./adapters/leeds.ts";
import { isReadingSource } from "./adapters/reading.ts";
import {
  isRockImperiumSource,
  envelopeKind,
  findRockImperiumLanding,
  findRockImperiumCategory,
  findRockImperiumProduct,
  type PassDocument,
} from "./adapters/rock-imperium.ts";
import { novarockDocuments, novarockTicketsUrl } from "./adapters/novarock.ts";
import type { FestivalSource } from "./types.ts";
import { discoverDynamoTickets } from "./adapters/dynamo-tickets.ts";
import { discoverDynamoBands, isDynamoAnnouncement } from "./adapters/dynamo.ts";
import {
  isGraspopSource,
  discoverGraspopAnnouncements,
  GRASPOP_HOME,
  GRASPOP_ROSTER,
  GRASPOP_DOCUMENTS,
} from "./adapters/graspop.ts";

export type FetchAttempt = { response: Response; attempts: number; verifiedPrimaryUrl?: string };
export type FetchOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
};

const retryable = (status: number) =>
  status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;

async function fetchSourceWithoutTicketSupplement(
  source: FestivalSource,
  options: FetchOptions = {},
): Promise<FetchAttempt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const fetchWithRetry = async (
    url: string,
    redirect: RequestRedirect = "follow",
    requestHeaders: Record<string, string> = {},
  ): Promise<FetchAttempt> => {
    let response: Response | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await fetchImpl(url, {
          redirect,
          signal: AbortSignal.timeout(20_000),
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-GB,en;q=0.8",
            "cache-control": "no-cache",
            "user-agent":
              "LoudWeekendBot/1.1 (+https://loudweekend.eu/; public festival-data monitor)",
            ...source.headers,
            ...requestHeaders,
          },
        });
      } catch (error) {
        if (attempt === maxAttempts)
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            attempts: attempt,
          });
        await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 30_000));
        continue;
      }
      if (response.ok || !retryable(response.status) || attempt === maxAttempts)
        return { response, attempts: attempt };
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const delay =
        Number.isFinite(retryAfter) && retryAfter >= 0
          ? Math.min(retryAfter * 1_000, 30_000)
          : Math.min(baseDelayMs * 2 ** (attempt - 1), 30_000);
      await sleep(delay);
    }
    throw new Error("Fetch attempts exhausted without a response");
  };

  validateBarcelonaFetch(source);

  if (isRoskildeSource(source) && !options.fetchImpl)
    return fetchRoskildeDocuments(source.editionYear);

  let initial = await fetchWithRetry(source.fetchUrl ?? source.url);
  validateBarcelonaFetch(source, initial);
  if (
    source.festivalSlug === "area53" &&
    (source.url !== "https://area53festival.at/de/" ||
      source.fetchUrl ||
      source.followLinkPattern ||
      (initial.response.ok && initial.response.url !== source.url))
  )
    throw Object.assign(new Error("Area 53 homepage changed its trusted identity"), {
      attempts: initial.attempts,
    });
  if (
    source.festivalSlug === "summer-punch" &&
    (source.url !== "https://summerpunchfestival.pl/" ||
      source.fetchUrl ||
      source.followLinkPattern ||
      (initial.response.ok && initial.response.url !== source.url))
  )
    throw Object.assign(new Error("Summer Punch homepage changed its trusted identity"), {
      attempts: initial.attempts,
    });
  if (initial.response.ok && isDownloadSource(source)) {
    let attempts = initial.attempts;
    try {
      if (
        source.fetchUrl ||
        source.followLinkPattern ||
        (initial.response.url && initial.response.url !== source.url)
      )
        throw new Error("Download homepage identity changed");
      const home = await initial.response.text();
      const artists = await fetchWithRetry(DOWNLOAD_ARTISTS, "error");
      attempts += artists.attempts;
      if (!artists.response.ok) return { response: artists.response, attempts };
      if (artists.response.url && artists.response.url !== DOWNLOAD_ARTISTS)
        throw new Error("Download artist listing identity changed");
      const artistHtml = await artists.response.text();
      const response = new Response(
        JSON.stringify({ kind: DOWNLOAD_DOCUMENTS, home, artists: artistHtml }),
        { headers: { "content-type": "application/json" } },
      );
      Object.defineProperty(response, "url", { value: source.url });
      return { response, attempts };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      throw Object.assign(failure, {
        attempts: attempts + Number((failure as Error & { attempts?: number }).attempts ?? 0),
      });
    }
  }
  if (initial.response.ok && isHeavyHomepage(source)) {
    let attempts = initial.attempts;
    try {
      if (
        source.fetchUrl ||
        source.followLinkPattern ||
        (initial.response.url && initial.response.url !== source.url)
      )
        throw new Error("Heavy Week-End homepage changed its configured identity");
      const home = await initial.response.text(),
        urls = heavyMissingArtistUrls(home, true);
      const documents = [];
      for (const url of urls) {
        let detail: FetchAttempt;
        try {
          detail = await fetchWithRetry(url, "error");
        } catch (error) {
          attempts += Number((error as Error & { attempts?: number })?.attempts ?? 0);
          throw error;
        }
        attempts += detail.attempts;
        if (!detail.response.ok) return { response: detail.response, attempts };
        if (detail.response.url && detail.response.url !== url)
          throw new Error("Heavy Week-End artist detail changed its trusted identity");
        const html = await detail.response.text();
        const logoUrl = heavyReviewedLogoUrl(url, source.editionYear);
        let logo: { url: string; sha256: string } | undefined;
        if (logoUrl) {
          let asset: FetchAttempt;
          try {
            asset = await fetchWithRetry(logoUrl, "error");
          } catch (error) {
            attempts += Number((error as Error & { attempts?: number })?.attempts ?? 0);
            throw error;
          }
          attempts += asset.attempts;
          if (!asset.response.ok) return { response: asset.response, attempts };
          if (asset.response.url && asset.response.url !== logoUrl)
            throw new Error("Heavy reviewed logo redirected");
          // Read a bounded body: a changed/oversized asset must retain review.
          const reader = asset.response.body?.getReader();
          if (!reader) throw new Error("Heavy reviewed logo is empty");
          const hash = createHash("sha256");
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 256_000) throw new Error("Heavy reviewed logo exceeds size limit");
              hash.update(value);
            }
          } finally {
            await reader.cancel();
          }
          logo = { url: logoUrl, sha256: hash.digest("hex") };
        }
        documents.push({ url, html, ...(logo ? { logo } : {}) });
      }
      return {
        response: new Response(JSON.stringify({ kind: HEAVY_DOCUMENTS, home, documents }), {
          headers: { "content-type": "application/json" },
        }),
        attempts,
      };
    } catch (error) {
      // Headers already count as a request even when identity checks or body
      // consumption subsequently fail; never discard earlier detail attempts.
      const failure = error instanceof Error ? error : new Error(String(error));
      throw Object.assign(failure, { attempts });
    }
  }
  if (
    ["vainstream", "rock-the-lakes", "provinssi"].includes(source.festivalSlug) &&
    source.strategies.includes("official_markup")
  ) {
    if (
      source.fetchUrl ||
      source.followLinkPattern ||
      (initial.response.url && initial.response.url !== source.url)
    )
      throw new Error("Official artist listing changed its configured identity");
    return initial;
  }
  if (initial.response.ok && isFullRewind(source)) {
    let attempts = initial.attempts;
    try {
      if (
        source.fetchUrl ||
        source.followLinkPattern ||
        (initial.response.url && initial.response.url !== source.url)
      )
        throw new Error("Full Rewind homepage identity changed");
      const home = await initial.response.text();
      const linked = [...home.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].some((m) => {
        try {
          return new URL(m[1], source.url).href === FULL_REWIND_BANDS;
        } catch {
          return false;
        }
      });
      if (!linked) throw new Error("Full Rewind official bands link missing");
      const bands = await fetchWithRetry(FULL_REWIND_BANDS, "error");
      attempts += bands.attempts;
      if (!bands.response.ok) return { response: bands.response, attempts };
      if (bands.response.url && bands.response.url !== FULL_REWIND_BANDS)
        throw new Error("Full Rewind bands identity changed");
      return {
        response: new Response(
          JSON.stringify({ kind: FULL_REWIND_DOCUMENTS, home, bands: await bands.response.text() }),
          { headers: { "content-type": "application/json" } },
        ),
        attempts,
      };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      throw Object.assign(failure, {
        attempts: attempts + Number((failure as Error & { attempts?: number }).attempts ?? 0),
      });
    }
  }
  if (initial.response.ok && isGraspopSource(source)) {
    if (initial.response.url && initial.response.url !== source.url)
      throw new Error("Graspop FAQ changed its official identity");
    const faq = await initial.response.text();
    let attempts = initial.attempts;
    const document = async (url: string) => {
      const r = await fetchWithRetry(url, "error");
      attempts += r.attempts;
      if (r.response.url && r.response.url !== url)
        throw new Error("Graspop document changed its official identity");
      return r.response;
    };
    const homeResponse = await document(GRASPOP_HOME);
    if (!homeResponse.ok) return { response: homeResponse, attempts };
    const home = await homeResponse.text();
    const urls = discoverGraspopAnnouncements(home);
    let roster = "";
    const articles = [];
    if (urls.length) {
      const rosterResponse = await document(GRASPOP_ROSTER);
      if (!rosterResponse.ok) return { response: rosterResponse, attempts };
      roster = await rosterResponse.text();
      for (const url of urls) {
        const article = await document(url);
        if (!article.ok) return { response: article, attempts };
        articles.push({ url, html: await article.text() });
      }
    }
    return {
      response: new Response(
        JSON.stringify({ kind: GRASPOP_DOCUMENTS, faq, home, roster, articles }),
        { headers: { "content-type": "application/json" } },
      ),
      attempts,
    };
  }
  if (initial.response.ok && isTuskaHomepage(source)) {
    if (initial.response.url && initial.response.url !== source.url)
      throw new Error("Tuska homepage redirected away from its trusted route");
    const home = await initial.response.text();
    const articleUrl = discoverTuskaAnnouncement(home, source.editionYear);
    const ticketsUrl = tuskaTicketsUrl(home, source);
    let attempts = initial.attempts;
    const documents: Record<string, { url: string; html: string }> = {};
    for (const [kind, url] of [
      ["article", articleUrl],
      ["tickets", ticketsUrl],
    ] as const) {
      if (!url) continue;
      const linked = await fetchWithRetry(url, "error");
      attempts += linked.attempts;
      if (!linked.response.ok) return { response: linked.response, attempts };
      if (linked.response.url && linked.response.url !== url)
        throw new Error("Tuska document changed its official identity");
      documents[kind] = { url, html: await linked.response.text() };
    }
    return {
      response: new Response(JSON.stringify({ kind: TUSKA_DOCUMENTS, home, ...documents }), {
        headers: { "content-type": "application/json" },
      }),
      attempts,
    };
  }
  if (initial.response.ok && isImpericonCurrentSource(source)) {
    if (initial.response.url && initial.response.url !== source.url)
      throw new Error("Impericon festival page redirected away from its trusted route");
    const home = await initial.response.text(),
      articles = [];
    let attempts = initial.attempts;
    // Every dependent request must retain completed homepage/listing/article
    // attempts when the next request throws, including same-article aliases.
    const request = async (url: string, redirect: RequestRedirect) => {
      let linked: FetchAttempt;
      try {
        linked = await fetchWithRetry(url, redirect);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        throw Object.assign(failure, {
          attempts: attempts + Number((failure as Error & { attempts?: number }).attempts ?? 0),
        });
      }
      attempts += linked.attempts;
      return linked;
    };
    let news: string | undefined;
    const newsUrl = impericonDynamicNewsUrl(home);
    if (newsUrl) {
      const listing = await request(newsUrl, "error");
      if (!listing.response.ok) return { response: listing.response, attempts };
      if (listing.response.url && listing.response.url !== newsUrl)
        throw new Error("Impericon dynamic news redirected away from its trusted route");
      news = await listing.response.text();
    }
    for (const url of discoverImpericonAnnouncements(home, source.editionYear, news)) {
      let linked = await request(url, "manual");
      if ([301, 302, 307, 308].includes(linked.response.status)) {
        const target = impericonArticleUrl(
          new URL(linked.response.headers.get("location") ?? "", url).href,
          source.editionYear,
        );
        if (!target || !sameImpericonArticle(url, target, source.editionYear))
          throw new Error("Impericon article redirected outside its exact official identity");
        linked = await request(target, "error");
      }
      if (!linked.response.ok) return { response: linked.response, attempts };
      if (
        linked.response.url &&
        !sameImpericonArticle(url, linked.response.url, source.editionYear)
      )
        throw new Error("Impericon article changed its official identity");
      articles.push({ url, html: await linked.response.text() });
    }
    const ticketProducts = [];
    let products: ReturnType<typeof impericonTicketProducts>;
    try {
      products = impericonTicketProducts(home, source.editionYear);
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attempts });
    }
    for (const product of products) {
      const linked = await request(product.url, "error");
      if (!linked.response.ok) return { response: linked.response, attempts };
      if (linked.response.url && linked.response.url !== product.url)
        throw Object.assign(new Error("Impericon public ticket product identity changed"), {
          attempts,
        });
      if (
        !/^(?:application\/json|text\/javascript|application\/javascript)\b/i.test(
          linked.response.headers.get("content-type") ?? "",
        )
      )
        throw Object.assign(
          new Error("Impericon public ticket product returned a non-JSON document"),
          { attempts },
        );
      try {
        ticketProducts.push({
          url: product.url,
          product: JSON.parse(await boundedTicketText(linked.response)),
        });
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          attempts,
        });
      }
    }
    return {
      response: new Response(
        JSON.stringify({
          kind: IMPERICON_DOCUMENTS,
          home,
          ...(news !== undefined ? { news } : {}),
          articles,
          ticketProducts,
        }),
        { headers: { "content-type": "application/json" } },
      ),
      attempts,
    };
  }
  if (
    initial.response.ok &&
    isRoadburnSource(source) &&
    !source.fetchUrl &&
    !source.followLinkPattern
  ) {
    if (initial.response.url && initial.response.url !== source.url)
      throw new Error("Roadburn homepage redirected away from its trusted route");
    const home = await initial.response.text();
    let attempts = initial.attempts;
    const linked = async (url: string) => {
      const result = await fetchWithRetry(url, "error");
      attempts += result.attempts;
      if (result.response.ok && result.response.url && roadburnUrl(result.response.url) !== url)
        throw new Error("Roadburn linked document redirected away from its trusted route");
      return result.response;
    };
    const documents: RoadburnDocument[] = [];
    let listing = home;
    if (roadburnLinked(home, "/news/")) {
      const news = await linked("https://roadburn.com/news/");
      if (!news.ok) return { response: news, attempts };
      listing = await news.text();
    }
    for (const url of discoverRoadburnAnnouncements(listing, source.editionYear)) {
      const response = await linked(url);
      if (!response.ok) return { response, attempts };
      documents.push({ url, html: await response.text() });
    }
    let tickets = "";
    if (roadburnLinked(home, "/tickets/")) {
      const response = await linked("https://roadburn.com/tickets/");
      if (!response.ok) return { response, attempts };
      tickets = await response.text();
    }
    return {
      response: new Response(roadburnDocuments(home, documents, tickets), {
        headers: { "content-type": "application/json" },
      }),
      attempts,
    };
  }
  if (initial.response.ok && handlesBrutalAssault(source))
    return fetchBrutalAssaultDocuments(source, initial, fetchWithRetry);
  if (
    initial.response.ok &&
    isLeyendasSource(source) &&
    !source.fetchUrl &&
    !source.followLinkPattern
  ) {
    if (initial.response.url && initial.response.url !== LEYENDAS_ORIGIN + "/")
      throw new Error("Leyendas homepage redirected away from the official origin");
    const home = await initial.response.text();
    if (!leyendasLinkedRoute(home, "/noticias/") || !leyendasLinkedRoute(home, "/tickets/"))
      throw new Error("Leyendas official news/ticket links are missing");
    let attempts = initial.attempts;
    const document = async (path: string) => {
      const result = await fetchWithRetry(path, "error");
      attempts += result.attempts;
      if (!result.response.ok) return { failed: result.response };
      if (result.response.url && result.response.url !== path)
        throw new Error("Leyendas linked document redirected");
      const html = await result.response.text();
      if (
        /request is being verified|<title[^>]*>\s*(?:One moment|Just a moment)|cf-chl-/i.test(html)
      )
        throw new Error("Leyendas official document is blocked by a verification challenge");
      return { html };
    };
    const news = await document(LEYENDAS_ORIGIN + "/noticias/");
    if (news.failed) return { response: news.failed, attempts };
    if (!/<h1\b[^>]*>\s*NOTICIAS\s*<\/h1>/i.test(news.html!))
      throw new Error("Leyendas official news index markup is missing");
    const tickets = await document(LEYENDAS_ORIGIN + "/tickets/");
    if (tickets.failed) return { response: tickets.failed, attempts };
    const posts = [];
    for (const url of leyendasNewsLinks(news.html!, source).slice(0, 8)) {
      const post = await document(url);
      if (post.failed) return { response: post.failed, attempts };
      posts.push({ url, html: post.html! });
    }
    return {
      response: new Response(
        JSON.stringify({
          kind: LEYENDAS_DOCUMENTS,
          home,
          news: news.html,
          tickets: tickets.html,
          posts,
        }),
        { headers: { "content-type": "application/json" } },
      ),
      attempts,
    };
  }
  if (
    initial.response.ok &&
    isInfernoSource(source) &&
    source.strategies.includes("html_fallback") &&
    initial.response.url &&
    !isInfernoResponse(initial.response.url)
  )
    throw Object.assign(new Error("Inferno source redirected away from its official homepage"), {
      attempts: initial.attempts,
    });
  if (
    initial.response.ok &&
    isAlpenFlairSource(source) &&
    source.strategies.includes("html_fallback") &&
    !source.fetchUrl &&
    !source.followLinkPattern
  ) {
    if (initial.response.url && !isAlpenFlairSource({ ...source, url: initial.response.url }))
      throw new Error("Alpen Flair homepage redirected away from its trusted route");
    const home = await initial.response.text(),
      articles: { url: string; html: string }[] = [];
    let attempts = initial.attempts;
    for (const url of alpenAnnouncements(home, source.editionYear!)) {
      const linked = await fetchWithRetry(url, "error");
      attempts += linked.attempts;
      if (!linked.response.ok) return { response: linked.response, attempts };
      if (linked.response.url && linked.response.url !== url)
        throw new Error("Alpen Flair announcement redirected away from its trusted route");
      articles.push({ url, html: await linked.response.text() });
    }
    return {
      response: new Response(alpenEnvelope(home, articles), {
        headers: { "content-type": "application/json" },
      }),
      attempts,
    };
  }
  if (
    source.festivalSlug === "motocultor" &&
    source.strategies.includes("official_markup") &&
    initial.response.ok
  ) {
    const url = new URL(source.fetchUrl ?? source.url);
    if (
      url.origin === "https://www.motocultor-festival.com" &&
      ["/", "/actualites/"].includes(url.pathname)
    ) {
      if (url.pathname === "/") {
        const news = await fetchWithRetry("https://www.motocultor-festival.com/actualites/");
        initial = { ...news, attempts: initial.attempts + news.attempts };
        if (!initial.response.ok) return initial;
      }
      const linkedUrl = discoverMotocultorAnnouncement(await initial.response.text(), source);
      if (!linkedUrl)
        throw Object.assign(new Error("No current-edition Motocultor announcement found"), {
          attempts: initial.attempts,
        });
      const linked = await fetchWithRetry(linkedUrl);
      if (linked.response.ok && linked.response.url && linked.response.url !== linkedUrl)
        throw Object.assign(
          new Error("Motocultor announcement changed its discovered official identity"),
          { attempts: initial.attempts + linked.attempts },
        );
      return {
        response: linked.response,
        attempts: initial.attempts + linked.attempts,
        verifiedPrimaryUrl: linkedUrl,
      };
    }
  }

  if (initial.response.ok && isCopenhellCurrentSource(source)) {
    if (initial.response.url && !copenhellUrl(initial.response.url))
      throw new Error("Copenhell source redirected outside its official origin");
    const documents: CopenhellDocument[] = [
      { url: source.url, html: await initial.response.text() },
    ];
    let attempts = initial.attempts;
    const read = async (url: string): Promise<Response | undefined> => {
      if (documents.some((d) => d.url === url)) return undefined;
      const result = await fetchWithRetry(url, "error");
      attempts += result.attempts;
      if (!result.response.ok) return result.response;
      if (result.response.url && result.response.url !== url)
        throw new Error("Copenhell official document redirected");
      documents.push({ url, html: await result.response.text() });
      return undefined;
    };
    const homeError = await read("https://copenhell.dk/");
    if (homeError) return { response: homeError, attempts };
    const home = documents.find((d) => d.url === "https://copenhell.dk/")!;
    for (const url of [
      ...copenhellNews(home.html, source.editionYear),
      "https://copenhell.dk/program/",
      "https://copenhell.dk/billetter/",
    ]) {
      const error = await read(url);
      if (error) return { response: error, attempts };
    }
    const program = documents.find((d) => d.url === "https://copenhell.dk/program/")!;
    for (const card of copenhellArtistLinks(program.html).filter(
      (c) => c.name.toUpperCase() === "ANGEL DUST",
    )) {
      const error = await read(card.url);
      if (error) return { response: error, attempts };
    }
    return {
      response: new Response(JSON.stringify({ kind: copenhellEnvelope, documents }), {
        headers: { "content-type": "application/json" },
      }),
      attempts,
    };
  }

  // Rock in Roma is a series: only concerts linked by the current-edition
  // grid define the range. Never crawl archive/news or third-party ticket sites.
  if (
    initial.response.ok &&
    isRockInRomaSource(source) &&
    source.strategies.includes("html_fallback") &&
    !source.followLinkPattern
  ) {
    const initialUrl = source.fetchUrl ?? source.url;
    if (initial.response.url && initial.response.url !== initialUrl)
      throw Object.assign(
        new Error("Rock in Roma source redirected away from its trusted origin or edition page"),
        { attempts: initial.attempts },
      );
    let html = await initial.response.text(),
      attempts = initial.attempts;
    if (new URL(initialUrl).pathname === "/") {
      const path = `/lineup-${source.editionYear}/`;
      const linked = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some((match) => {
        try {
          const url = new URL(match[1], source.url);
          return (
            url.origin === "https://rockinroma.com" &&
            url.pathname === path &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      });
      if (!linked)
        return { response: new Response(html, { headers: initial.response.headers }), attempts };
      const url = new URL(path, source.url).href;
      const lineup = await fetchWithRetry(url, "error");
      attempts += lineup.attempts;
      if (!lineup.response.ok) return { response: lineup.response, attempts };
      if (lineup.response.url && lineup.response.url !== url)
        throw Object.assign(
          new Error("Rock in Roma lineup redirected away from its trusted edition page"),
          { attempts },
        );
      html = await lineup.response.text();
    }
    const links = rockInRomaConcerts(html, source);
    if (links.length > 80)
      throw Object.assign(new Error("Rock in Roma concert discovery exceeds its bounded limit"), {
        attempts,
      });
    const concerts: RockInRomaDocument[] = [];
    for (const { url } of links) {
      const detail = await fetchWithRetry(url, "error");
      attempts += detail.attempts;
      if (!detail.response.ok) return { response: detail.response, attempts };
      if (detail.response.url && detail.response.url !== url)
        throw Object.assign(
          new Error("Rock in Roma concert redirected away from its trusted identity"),
          { attempts },
        );
      concerts.push({ url, html: await detail.response.text() });
    }
    return {
      response: new Response(
        JSON.stringify({ kind: ROCK_IN_ROMA_DOCUMENTS, lineup: html, concerts }),
        { headers: { "content-type": "application/json" } },
      ),
      attempts,
    };
  }
  if (isPolandrockSource(source) && initial.response.ok) {
    if (initial.response.url && new URL(initial.response.url).origin !== new URL(source.url).origin)
      throw Object.assign(new Error("Pol'and'Rock homepage redirected off official origin"), {
        attempts: initial.attempts,
      });
    const html = await initial.response.text();
    const url = polandrockAnnouncementUrl(html, source);
    if (url) {
      const announcement = await fetchWithRetry(url);
      const attempts = initial.attempts + announcement.attempts;
      // Provider failures remain real failures; never wrap a 403 as HTTP200.
      if (!announcement.response.ok) return { response: announcement.response, attempts };
      if (
        announcement.response.url &&
        new URL(announcement.response.url).origin !== new URL(source.url).origin
      )
        throw Object.assign(new Error("Pol'and'Rock announcement redirected off official origin"), {
          attempts,
        });
      const body = await announcement.response.text();
      return {
        response: new Response(
          `${html}\n<template data-pnr-announcement-source="${encodeURIComponent(url)}">${body}</template>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
        attempts,
      };
    }
    // No announcement alone is not failure: retain current dated roster and
    // leave absent endDate untouched rather than guessing festival duration.
    return {
      response: new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      attempts: initial.attempts,
    };
  }
  if (
    initial.response.ok &&
    isFrequencySource(source) &&
    source.strategies.includes("html_fallback") &&
    !source.fetchUrl &&
    !source.followLinkPattern &&
    new URL(source.url).pathname === "/"
  ) {
    if (initial.response.url && new URL(initial.response.url).origin !== "https://www.frequency.at")
      throw Object.assign(
        new Error("Frequency homepage redirected away from its official origin"),
        { attempts: initial.attempts },
      );
    const home = await initial.response.text();
    if (!frequencyTicketLink(home))
      return {
        response: new Response(home, { status: 200, headers: initial.response.headers }),
        attempts: initial.attempts,
      };
    const tickets = await fetchWithRetry("https://www.frequency.at/tickets/");
    const attempts = initial.attempts + tickets.attempts;
    if (!tickets.response.ok) return { response: tickets.response, attempts };
    if (
      tickets.response.url &&
      !/^https:\/\/www\.frequency\.at\/tickets\/?$/.test(tickets.response.url)
    )
      throw Object.assign(
        new Error("Frequency ticket page redirected away from its official landing page"),
        { attempts },
      );
    return {
      response: new Response(frequencyDocuments(home, await tickets.response.text()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      attempts,
    };
  }
  // Paléo's homepage redirects to French and exposes only a ticket CTA.
  // Follow the actual same-origin localized landing page, never the account shop.
  if (
    initial.response.ok &&
    isPaleoSource(source) &&
    source.strategies.includes("html_fallback") &&
    !source.fetchUrl &&
    !source.followLinkPattern
  ) {
    if (initial.response.url && !isPaleoSource({ ...source, url: initial.response.url }))
      throw Object.assign(new Error("Paleo source redirected away from its trusted route"), {
        attempts: initial.attempts,
      });
    if (
      isPaleoTicketUrl(source.url) ||
      (initial.response.url && isPaleoTicketUrl(initial.response.url))
    )
      return initial;
    const html = await initial.response.text();
    const link = paleoTicketLink(html, initial.response.url || source.url);
    if (!link)
      return {
        response: new Response(html, {
          status: initial.response.status,
          headers: initial.response.headers,
        }),
        attempts: initial.attempts,
      };
    const tickets = await fetchWithRetry(link);
    if (tickets.response.ok && tickets.response.url && !isPaleoTicketUrl(tickets.response.url))
      throw Object.assign(new Error("Paleo ticket page redirected away from its trusted route"), {
        attempts: initial.attempts + tickets.attempts,
      });
    return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
  }
  if (
    initial.response.ok &&
    isLeedsSource(source) &&
    !source.fetchUrl &&
    initial.response.url &&
    new URL(initial.response.url).origin !== "https://www.leedsfestival.com"
  )
    throw Object.assign(new Error("Leeds source redirected away from its trusted origin"), {
      attempts: initial.attempts,
    });
  // Leeds's homepage carries the current festival span but only a sales CTA.
  // Read the same-origin linked live ticket products to establish availability.
  if (
    initial.response.ok &&
    isLeedsSource(source) &&
    source.strategies.includes("html_fallback") &&
    !source.fetchUrl &&
    !source.followLinkPattern &&
    new URL(source.url).pathname === "/"
  ) {
    const html = await initial.response.text();
    const linked = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some((match) => {
      try {
        const url = new URL(match[1], source.url);
        return (
          url.origin === "https://www.leedsfestival.com" &&
          /^\/tickets\/?$/.test(url.pathname) &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    });
    if (!linked)
      return {
        response: new Response(html, {
          status: initial.response.status,
          headers: initial.response.headers,
        }),
        attempts: initial.attempts,
      };
    const tickets = await fetchWithRetry("https://www.leedsfestival.com/tickets");
    if (
      tickets.response.ok &&
      tickets.response.url &&
      !/^https:\/\/www\.leedsfestival\.com\/tickets\/?$/.test(tickets.response.url)
    )
      throw Object.assign(
        new Error("Leeds ticket page redirected away from its trusted landing page"),
        { attempts: initial.attempts + tickets.attempts },
      );
    return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
  }
  if (
    initial.response.ok &&
    isReadingSource(source) &&
    !source.fetchUrl &&
    initial.response.url &&
    new URL(initial.response.url).origin !== "https://www.readingfestival.com"
  )
    throw Object.assign(new Error("Reading source redirected away from its trusted origin"), {
      attempts: initial.attempts,
    });
  // Reading's homepage carries the current festival span but only a sales CTA.
  // Read the same-origin linked live ticket products to establish availability.
  if (
    initial.response.ok &&
    isReadingSource(source) &&
    source.strategies.includes("html_fallback") &&
    !source.fetchUrl &&
    !source.followLinkPattern &&
    new URL(source.url).pathname === "/"
  ) {
    const html = await initial.response.text();
    const linked = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some((match) => {
      try {
        const url = new URL(match[1], source.url);
        return (
          url.origin === "https://www.readingfestival.com" &&
          /^\/tickets\/?$/.test(url.pathname) &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    });
    if (!linked)
      return {
        response: new Response(html, {
          status: initial.response.status,
          headers: initial.response.headers,
        }),
        attempts: initial.attempts,
      };
    const tickets = await fetchWithRetry("https://www.readingfestival.com/tickets");
    if (
      tickets.response.ok &&
      tickets.response.url &&
      !/^https:\/\/www\.readingfestival\.com\/tickets\/?$/.test(tickets.response.url)
    )
      throw Object.assign(
        new Error("Reading ticket page redirected away from its trusted landing page"),
        { attempts: initial.attempts + tickets.attempts },
      );
    return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
  }
  if (initial.response.ok && isDynamoAnnouncement(source)) {
    let attempts = initial.attempts;
    try {
      if (initial.response.url && initial.response.url !== source.url)
        throw new Error("Dynamo announcement redirected");
      const linkedPage = async (url: string, headers?: Record<string, string>) => {
        const linked = await fetchWithRetry(url, "error", headers);
        attempts += linked.attempts;
        return linked.response;
      };
      const bands = await discoverDynamoBands(await initial.response.text(), linkedPage);
      const body = await discoverDynamoTickets(bands, linkedPage);
      const headers = new Headers(initial.response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return { response: new Response(body, { status: 200, headers }), attempts };
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attempts });
    }
  }
  if (isRockImperiumSource(source) && initial.response.ok) {
    const finalUrl = new URL(initial.response.url || source.url);
    if (
      finalUrl.protocol !== "https:" ||
      finalUrl.hostname !== "www.rockimperiumfestival.es" ||
      !/^\/(?:es\/|en\/)?$/.test(finalUrl.pathname)
    )
      throw new Error("Rock Imperium homepage redirected outside its official gateway");
    const home = await initial.response.text();
    const documents: PassDocument[] = [];
    let attempts = initial.attempts;
    let url = findRockImperiumLanding(home, source);
    for (let hop = 0; hop < 3 && url; hop += 1) {
      // Linked seller pages must not redirect outside the reviewed origin.
      const linked = await fetchWithRetry(url, "error");
      attempts += linked.attempts;
      if (!linked.response.ok) return { response: linked.response, attempts };
      if (linked.response.url && linked.response.url !== url)
        throw new Error("Rock Imperium linked document redirected");
      const document = { url, html: await linked.response.text() };
      documents.push(document);
      const categoryUrl = findRockImperiumCategory(document, source.editionYear);
      url =
        categoryUrl === document.url
          ? findRockImperiumProduct(document, source.editionYear)
          : categoryUrl;
    }
    return {
      response: new Response(JSON.stringify({ kind: envelopeKind, home, documents }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      attempts,
    };
  }
  if (
    source.festivalSlug === "nova-rock" &&
    source.strategies.includes("official_markup") &&
    source.url === "https://www.novarock.at/lineup/" &&
    !source.fetchUrl &&
    !source.followLinkPattern &&
    initial.response.ok
  ) {
    const tickets = await fetchWithRetry(novarockTicketsUrl);
    if (!tickets.response.ok)
      return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
    return {
      response: new Response(
        novarockDocuments(await initial.response.text(), await tickets.response.text()),
        { headers: { "content-type": "application/json" } },
      ),
      attempts: initial.attempts + tickets.attempts,
    };
  }
  if (!source.followLinkPattern || !initial.response.ok) return initial;

  const html = await initial.response.text();
  const pattern = new RegExp(source.followLinkPattern, "i");
  const linkedUrl = [
    ...html.matchAll(/<(?:a\b[^>]*href|script\b[^>]*src)\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi),
  ]
    .map((match) => match[1] ?? match[2])
    .map((href) => {
      try {
        return new URL(href, initial.response.url || source.fetchUrl || source.url);
      } catch {
        return undefined;
      }
    })
    .find((url) => url && pattern.test(url.pathname));
  if (!linkedUrl)
    throw Object.assign(new Error(`No official linked page matched ${source.followLinkPattern}`), {
      attempts: initial.attempts,
    });

  const linked = await fetchWithRetry(linkedUrl.href);
  return { response: linked.response, attempts: initial.attempts + linked.attempts };
}

async function boundedTicketText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty official ticket document");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Official ticket document exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchSource(
  source: FestivalSource,
  options: FetchOptions = {},
): Promise<FetchAttempt> {
  const primary = await fetchSourceWithoutTicketSupplement(source, options);
  const ticketUrl = ticketSupplementUrl(source);
  if (!primary.response.ok || !ticketUrl) return primary;
  let attempts = primary.attempts;
  try {
    if (
      !matchesTicketPrimaryUrl(source, primary.response.url) &&
      primary.response.url !== primary.verifiedPrimaryUrl &&
      !(source.festivalSlug === "alcatraz" && alcatrazPrimaryUrl(source.url, primary.response.url))
    )
      throw new Error("Official ticket primary source changed identity");
    const body = await boundedTicketText(primary.response);
    // Reuse the normal bounded-retry transport, without recursive supplements,
    // source overrides or authorization headers on a public ticket destination.
    const ticket = await fetchSourceWithoutTicketSupplement(
      {
        ...source,
        url: ticketUrl,
        headers: undefined,
        fetchUrl: undefined,
        followLinkPattern: undefined,
        strategies: ["html_fallback"],
      },
      options,
    );
    attempts += ticket.attempts;
    if (!ticket.response.ok) return { response: ticket.response, attempts };
    if (ticket.response.url && ticket.response.url !== ticketUrl)
      throw new Error("Official ticket destination changed identity");
    const type = ticket.response.headers.get("content-type") ?? "";
    const supportedType =
      source.festivalSlug === "alcatraz"
        ? /^application\/json\b/i.test(type)
        : source.festivalSlug === "full-rewind" || ticketUrl === RFP_STOCK
          ? /^(?:application\/json|text\/javascript|application\/javascript)\b/i.test(type)
          : /^text\/html\b|^application\/xhtml\+xml\b/i.test(type);
    if (!supportedType)
      throw new Error(
        source.festivalSlug === "full-rewind"
          ? "Official ticket destination returned a non-JSON document"
          : "Official ticket destination returned a non-HTML document",
      );
    const rawTicket = await boundedTicketText(ticket.response);
    const html = ticketUrl === RFP_STOCK ? reduceRfpStockDocument(rawTicket) : rawTicket;
    const response = new Response(
      JSON.stringify({ kind: TICKET_SUPPLEMENT, body, ticket: { url: ticketUrl, html } }),
      { headers: { "content-type": "application/json" } },
    );
    Object.defineProperty(response, "url", { value: source.url });
    return { response, attempts };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    throw Object.assign(failure, {
      attempts: attempts + Number((failure as Error & { attempts?: number }).attempts ?? 0),
    });
  }
}
