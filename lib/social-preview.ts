import type { Metadata } from "next";
import { formatFestivalDateRange } from "./festival-dates.ts";
import type { Language } from "./language-preference.ts";
import { SITE_ORIGIN } from "./seo.ts";

const copy = {
  en: {
    festivals: "Festival",
    artists: "Artist",
    unknown: "Dates not confirmed",
    hiatus: "Edition on hiatus",
  },
  de: {
    festivals: "Festival",
    artists: "Künstler",
    unknown: "Termine nicht bestätigt",
    hiatus: "Festivalausgabe pausiert",
  },
  ru: {
    festivals: "Фестиваль",
    artists: "Артист",
    unknown: "Даты не подтверждены",
    hiatus: "Фестиваль на паузе",
  },
} satisfies Record<Language, Record<string, string>>;

export type PreviewKind = "festivals" | "artists";
type PreviewTarget =
  | { kind: "festivals"; slug: string; name: string; year: number }
  | { kind: "artists"; slug: string; name: string };

export const previewSize = { width: 1200, height: 630 };

export function socialPreviewMetadata(
  target: PreviewTarget,
  canonical: string,
  language: Language = "en",
): Pick<Metadata, "openGraph" | "twitter"> {
  const { kind, name, slug } = target;
  const yearPath = kind === "festivals" ? `/${target.year}` : "";
  const base = `${SITE_ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH || ""}`;
  const image = {
    url: `${base}/api/social/${language}/${kind}/${encodeURIComponent(slug)}${yearPath}/`,
    alt: `${copy[language][kind]}: ${name}${kind === "festivals" ? ` · ${target.year}` : ""}`,
    type: "image/png",
    ...previewSize,
  };
  return {
    openGraph: { type: "website", title: name, url: base + canonical, images: [image] },
    twitter: { card: "summary_large_image", title: name, images: [image] },
  };
}

export type PreviewCard = {
  kind: PreviewKind;
  language: Language;
  name: string;
  detail?: string;
  headliners?: readonly string[];
};

export function previewLabel(card: PreviewCard) {
  return copy[card.language][card.kind];
}

export function festivalPreviewDate(
  year: number,
  language: Language,
  dates: { startDate?: string; endDate?: string } | null,
) {
  const formatted = dates && formatFestivalDateRange(dates, language, "");
  return formatted || `${year} · ${copy[language].unknown}`;
}

export function festivalPreviewHiatus(year: number, language: Language) {
  return `${year} · ${copy[language].hiatus}`;
}

/** Keep stored billing intact in metadata; bound only its visual representation. */
export function previewText(value: string, limit: number) {
  const text = value.replace(/[\s\p{Cc}\p{Bidi_Control}]+/gu, " ").trim();
  const segments = new Intl.Segmenter().segment(text);
  let count = 0;
  for (const { index } of segments) {
    if (count++ === limit) return text.slice(0, index).trimEnd() + "…";
  }
  return text;
}
