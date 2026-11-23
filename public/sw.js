/* Loud Weekend public-only service worker. DB catalogue freshness uses its ETag. */
const BASE = new URL(self.registration?.scope ?? self.location.origin).pathname.replace(/\/$/, "");
const CACHE_SCOPE = BASE ? `:${encodeURIComponent(BASE)}` : "";
const CACHE_VERSION = `festival-radar-public-v13${CACHE_SCOPE}`;
const CATALOG = `${BASE}/api/offline/catalog`;
const TRIP_MODULE = `${BASE}/offline-trips.mjs`;
const TRIP_SHELL_QUERY = "?shell=13";
const MAX_ENTRIES = 80;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_PAGE = `${BASE}/offline.html`;
const PRECACHE = [
  OFFLINE_PAGE,
  TRIP_MODULE,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/icon-maskable-512.png`,
];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isPrivatePath(pathname) {
  return pathname.startsWith("/api/") ||
    pathname === "/login" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/sync") ||
    pathname.startsWith("/share") ||
    pathname.startsWith("/notifications");
}

function isPublicAsset(url) {
  return url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/logos/") ||
    url.pathname === "/manifest.webmanifest";
}

function cacheable(response) {
  if (!response || response.status !== 200 || response.type === "opaque") return false;
  const control = response.headers.get("cache-control") || "";
  return !/no-store|private/i.test(control) && !response.headers.has("set-cookie");
}

async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set("x-festival-radar-cached-at", String(Date.now()));
  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function freshCached(cache, request) {
  const response = await cache.match(request);
  if (!response) return undefined;
  const storedAt = Number(response.headers.get("x-festival-radar-cached-at"));
  if (!storedAt || Date.now() - storedAt > MAX_AGE_MS) {
    await cache.delete(request);
    return undefined;
  }
  return response;
}

async function trim(cache) {
  // Keep the installed shell and its modules usable when browsing fills the asset cache.
  const pinned = new Set([...PRECACHE, CATALOG].map((path) => new URL(path, self.location.origin).href));
  const keys = await cache.keys();
  const evictable = keys.filter((key) => !pinned.has(new URL(key.url ?? key, self.location.origin).href));
  for (const key of evictable.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
}

function publicCatalogHeaders(response) {
  const control = response.headers.get("cache-control") || "";
  const revision = response.headers.get("x-catalog-revision");
  const vary = response.headers.get("vary") || "";
  return /(?:^|,)\s*public\s*(?:,|$)/i.test(control) &&
    !/no-store|private/i.test(control) && !response.headers.has("set-cookie") &&
    !/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(vary) &&
    !response.redirected && response.type !== "opaque" &&
    /^[a-f0-9]{64}$/.test(revision || "") && response.headers.get("etag") === `"${revision}"`;
}

function hasFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

const catalogDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const catalogText = (value) => typeof value === "string" && value.trim().length > 0;

function catalogPerformance(row) {
  return hasFields(row, ["date", "stage", "start", "artist", "timeZone", "status"]) &&
    catalogDate(row.date) && catalogText(row.stage) && catalogText(row.artist) && catalogText(row.timeZone) &&
    typeof row.start === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.start) &&
    (row.status === "scheduled" || row.status === "cancelled");
}

function catalogFestival(row) {
  return hasFields(row, ["slug", "name", "startDate", "endDate", "timetable"]) &&
    typeof row.slug === "string" && /^[a-z0-9-]+$/.test(row.slug) && catalogText(row.name) &&
    (row.startDate === null || catalogDate(row.startDate)) &&
    (row.endDate === null || catalogDate(row.endDate)) &&
    (row.startDate === null || row.endDate === null || row.startDate <= row.endDate) &&
    Array.isArray(row.timetable) && row.timetable.every((performance) =>
      catalogPerformance(performance) &&
      (row.startDate === null || row.startDate <= performance.date) &&
      (row.endDate === null || performance.date <= row.endDate));
}

function validCatalog(body) {
  // Only persist the known public projection, never extra response fields.
  if (!hasFields(body, ["schemaVersion", "dataVersion", "editionYear", "generatedAt", "timetableStatus", "festivals"]) ||
      body.schemaVersion !== 1 || !Number.isInteger(body.editionYear) ||
      body.editionYear < 1000 || body.editionYear > 9999 ||
      body.dataVersion !== `festivals-${body.editionYear}-v1` || body.generatedAt !== null ||
      !Array.isArray(body.festivals) || !body.festivals.length || !body.festivals.every(catalogFestival)) return false;
  const hasTimetable = body.festivals.some((festival) => festival.timetable.length);
  return body.timetableStatus === (hasTimetable ? "published" : "not-published");
}

async function usableCatalog(response) {
  if (!response || response.status !== 200 || !publicCatalogHeaders(response) ||
      !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")) return false;
  try {
    return validCatalog(await response.clone().json());
  } catch { return false; }
}

// Keep cache mutations ordered without making one network request wait for another.
let catalogCacheWork = Promise.resolve();
let nextCatalogRequest = 0;
let lastCachedRequest = 0;

function accessCatalogCache(operation) {
  const result = catalogCacheWork.then(operation);
  catalogCacheWork = result.catch(() => undefined);
  return result;
}

async function readCachedCatalog(cache) {
  const candidate = await freshCached(cache, CATALOG);
  if (await usableCatalog(candidate)) return candidate;
  if (candidate) await cache.delete(CATALOG);
  return undefined;
}

async function catalogResponse() {
  const order = ++nextCatalogRequest;
  // Cache Storage may be unavailable (quota/privacy settings). First fetch must still work.
  const cache = await caches.open(CACHE_VERSION).catch(() => undefined);
  const cached = cache ? await accessCatalogCache(() => readCachedCatalog(cache)).catch(() => undefined) : undefined;
  // Next's trailingSlash configuration redirects the bare API path. Fetch its canonical URL.
  const request = (etag) => new Request(new URL(`${CATALOG}/`, self.location.origin), {
    credentials: "omit", cache: "no-store", redirect: "error",
    headers: { Accept: "application/json", ...(etag ? { "If-None-Match": etag } : {}) },
  });
  const save = async (response) => {
    if (!cache) return response;
    return accessCatalogCache(async () => {
      // An earlier 304 only describes the body used for that request, not the newer cache entry.
      if (order < lastCachedRequest) return (await readCachedCatalog(cache)) ?? response;
      await cache.put(CATALOG, await stamped(response));
      lastCachedRequest = order;
      await trim(cache);
      return response;
    }).catch(() => response);
  };
  let response;
  try {
    response = await fetch(request(cached?.headers.get("etag")));
    if (response.status === 304) {
      if (cached && publicCatalogHeaders(response) &&
          response.headers.get("etag") === cached.headers.get("etag")) return save(cached);
      // Never expose a bodyless 304 to JSON consumers or accept a mismatched revision.
      response = await fetch(request());
    }
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
  if (await usableCatalog(response)) return save(response);
  if (response.ok || response.status === 304) {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return response;
}

async function precache(cache) {
  await Promise.all(PRECACHE.map(async (url) => {
    const response = await fetch(url, { cache: "reload" });
    if (!cacheable(response)) throw new Error(`Unable to precache ${url}: HTTP ${response.status}`);
    await cache.put(url, await stamped(response));
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then(precache)
    // DB unavailability must not prevent the existing static offline shell installing.
    .then(() => catalogResponse().catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) =>
      key !== CACHE_VERSION && /^festival-radar-public-v\d+/.test(key) &&
      key.replace(/^festival-radar-public-v\d+/, "") === CACHE_SCOPE
    ).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!sameOrigin(url) || (BASE && !url.pathname.startsWith(BASE + "/"))) return;
  const localPath = url.pathname.slice(BASE.length);
  if (url.pathname === TRIP_MODULE && (!url.search || url.search === TRIP_SHELL_QUERY)) {
    event.respondWith(caches.open(CACHE_VERSION).then((cache) => cache.match(TRIP_MODULE))
      .catch(() => undefined).then((cached) => cached ?? fetch(request)));
    return;
  }
  if ((url.pathname === CATALOG || url.pathname === `${CATALOG}/`) &&
      !url.search && request.mode !== "navigate" &&
      !request.headers?.has("authorization") && !request.headers?.has("cookie")) {
    event.respondWith(catalogResponse());
    return;
  }
  if (isPrivatePath(localPath)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_VERSION);
      const page = await cache.match(OFFLINE_PAGE);
      return cacheable(page) ? page : Response.error();
    }));
    return;
  }

  if (!isPublicAsset({ pathname: localPath })) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION).catch(() => undefined);
    const cached = cache && await freshCached(cache, request).catch(() => undefined);
    if (cached) return cached;
    const response = await fetch(request);
    if (cache && cacheable(response)) {
      try {
        await cache.put(request, await stamped(response));
        await trim(cache);
      } catch { /* Use the successful network response even when cache storage fails. */ }
    }
    return response;
  })());
});

// Intentionally available only for deterministic VM tests; ignored by browsers.
if (typeof module !== "undefined") module.exports = { sameOrigin, isPrivatePath, isPublicAsset, cacheable };
