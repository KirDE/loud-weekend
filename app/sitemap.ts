import type { MetadataRoute } from "next";
import { supportedLanguages } from "@/lib/catalog/public";
import { DatabaseCatalogRepository } from "@/lib/catalog/repository";
import { editionKey, latestDate } from "@/lib/catalog/freshness";
import { readSitemapPublications } from "@/lib/catalog/sitemap-publications";
import { festivalOverlapsMonth } from "@/lib/festival-dates";
import { localizedAlternates, SITE_ORIGIN } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { db } = await import("@/lib/db");
  const now = new Date();
  const [{ festivals, artists, editions }, publications] = await db.$transaction(
    async (tx) => {
      const catalog = await new DatabaseCatalogRepository(tx).read();
      return [catalog, await readSitemapPublications(tx, now)] as const;
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
    const publication =
      editionYear === undefined ? undefined : publications.get(editionKey(slug, editionYear));
    const nameDate = sharedNames.get(slug);
    const lastModified = latestDate([publication?.festival ?? undefined, nameDate]);
    const directoryDate = latestDate([publication?.directory ?? undefined, nameDate]);
    const appearanceDate = latestDate([publication?.appearance ?? undefined, nameDate]);
    homeDates.push(lastModified);
    addLocalized(`/festivals/${slug}/`, lastModified);
    for (const name of [...headliners, ...lineup]) {
      appearanceDates.set(name, latestDate([appearanceDates.get(name), appearanceDate]));
    }
    if (/^[A-Z]{2}$/.test(countryCode)) {
      countries.set(countryCode, latestDate([countries.get(countryCode), directoryDate]));
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
  for (const { slug, editionYear, snapshotAt, recordState } of editions) {
    const publication = publications.get(editionKey(slug, editionYear));
    const nameDate = sharedNames.get(slug);
    const validSnapshot =
      snapshotAt && Date.parse(snapshotAt) <= now.getTime() ? snapshotAt : undefined;
    add(
      `/festivals/${slug}/${editionYear}/`,
      latestDate([publication?.edition ?? undefined, nameDate, validSnapshot]),
    );
    const listingDate = latestDate([publication?.listing ?? undefined, nameDate]);
    years.set(editionYear, latestDate([years.get(editionYear), listingDate]));
    if (recordState === "archived" || recordState === "tracking") archiveDates.push(listingDate);
  }
  for (const [year, date] of years) add(`/editions/${year}/`, date);
  add("/archive/", latestDate(archiveDates));
  add("/submit/");
  for (const language of supportedLanguages) {
    add(`/${language}/about/`);
    add(`/${language}/faq/`);
  }
  return [...entries.values()];
}
