import { hasArchiveRecords } from "@/lib/catalog/browse";
import type { MetadataRoute } from "next";
import { supportedLanguages } from "@/lib/catalog/public";
import { DatabaseCatalogRepository } from "@/lib/catalog/repository";
import { editionKey, latestDate } from "@/lib/catalog/freshness";
import {
  readSitemapPublications,
  readSitemapTicketOfferApprovals,
} from "@/lib/catalog/sitemap-publications";
import { guideTopics } from "@/lib/festival-guides";
import { festivalOverlapsMonth } from "@/lib/festival-dates";
import { localizedAlternates, SITE_ORIGIN } from "@/lib/seo";
import { publicSeasonEditions } from "@/lib/catalog/seasons";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { db } = await import("@/lib/db");
  const now = new Date();
  const [{ festivals, artists, editions }, publications, tierApprovals] = await db.$transaction(
    async (tx) => {
      const catalog = await new DatabaseCatalogRepository(db).readInSnapshot(tx);
      const publications = await readSitemapPublications(tx, now);
      const tierApprovals = await readSitemapTicketOfferApprovals(tx, catalog.festivals, now);
      return [catalog, publications, tierApprovals] as const;
    },
    { isolationLevel: "RepeatableRead" },
  );
  const entries = new Map<string, MetadataRoute.Sitemap[number]>();
  const sharedNames = new Map<string, string | undefined>();
  for (const { slug, sharedName } of publications.values()) {
    sharedNames.set(slug, latestDate([sharedNames.get(slug), sharedName ?? undefined]));
  }

  const add = (path: string, lastModified?: string, languages?: Record<string, string>) => {
    const url = SITE_ORIGIN + path;
    entries.set(url, {
      url,
      ...(lastModified && { lastModified }),
      ...(languages && { alternates: { languages } }),
    });
  };
  const addLocalized = (path: string, lastModified?: string) => {
    const paths = localizedAlternates(path);
    const languages = Object.fromEntries(
      Object.entries(paths).map(([lang, href]) => [lang, SITE_ORIGIN + href]),
    );
    for (const href of Object.values(paths)) add(href, lastModified, languages);
  };

  const homeDates: (string | undefined)[] = [];
  const appearanceDates = new Map<string, string | undefined>();
  const countries = new Map<string, string | undefined>();
  const months = new Map<number, string | undefined>();
  for (const festival of festivals) {
    const { slug, editionYear, countryCode, lineup, headliners } = festival;
    const key = editionYear === undefined ? undefined : editionKey(slug, editionYear);
    const publication = key === undefined ? undefined : publications.get(key);
    const nameDate = sharedNames.get(slug);
    const approvedAt = festival.editionLifecycle?.approvedAt;
    const lifecycleApproval =
      approvedAt && Date.parse(approvedAt) <= now.getTime() ? approvedAt : undefined;
    const lastModified = latestDate([
      publication?.festival ?? undefined,
      nameDate,
      key === undefined ? undefined : tierApprovals.get(key),
      lifecycleApproval,
    ]);
    const directoryDate = latestDate([publication?.directory ?? undefined, nameDate]);
    const appearanceDate = latestDate([publication?.appearance ?? undefined, nameDate]);
    homeDates.push(lastModified);
    if (festival.venue) homeDates.push(publication?.homeVenue ?? undefined);
    addLocalized(`/festivals/${slug}/`, lastModified);
    for (const name of [...headliners, ...lineup]) {
      appearanceDates.set(name, latestDate([appearanceDates.get(name), appearanceDate]));
    }
    if (/^[A-Z]{2}$/.test(countryCode)) {
      countries.set(
        countryCode,
        latestDate([countries.get(countryCode), directoryDate, lifecycleApproval]),
      );
    }
    for (let month = 1; month <= 12; month += 1) {
      if (festivalOverlapsMonth(festival, month))
        months.set(month, latestDate([months.get(month), directoryDate]));
    }
  }

  addLocalized("/", latestDate(homeDates));
  for (const { name, slug } of artists)
    addLocalized(`/artists/${slug}/`, appearanceDates.get(name));
  for (const [code, date] of countries) add(`/countries/${code.toLowerCase()}/`, date);
  for (const [month, date] of months) add(`/months/${String(month).padStart(2, "0")}/`, date);

  const years = new Map<number, string | undefined>();
  const archiveDates: (string | undefined)[] = [];
  const publicEditions = publicSeasonEditions(editions);
  for (const { slug, editionYear, snapshotAt } of publicEditions) {
    const publication = publications.get(editionKey(slug, editionYear));
    const nameDate = sharedNames.get(slug);
    const validSnapshot =
      snapshotAt && Date.parse(snapshotAt) <= now.getTime() ? snapshotAt : undefined;
    add(
      `/festivals/${slug}/${editionYear}/`,
      latestDate([publication?.edition ?? undefined, nameDate, validSnapshot]),
    );
  }
  for (const { slug, editionYear, recordState } of publicEditions) {
    const publication = publications.get(editionKey(slug, editionYear));
    const listingDate = latestDate([publication?.listing ?? undefined, sharedNames.get(slug)]);
    years.set(editionYear, latestDate([years.get(editionYear), listingDate]));
    if (recordState === "archived" || recordState === "tracking") archiveDates.push(listingDate);
  }
  for (const [year, date] of years) addLocalized(`/editions/${year}/`, date);
  add("/browse/");
  if (hasArchiveRecords(publicEditions)) add("/archive/", latestDate(archiveDates));
  add("/submit/");
  for (const topic of guideTopics) addLocalized(`/guides/${topic}/`);
  for (const language of supportedLanguages) {
    add(`/${language}/about/`);
    add(`/${language}/faq/`);
  }
  return [...entries.values()];
}
