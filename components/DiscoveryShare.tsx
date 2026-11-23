"use client";

import { useState } from "react";
import { reversedDiscoveryDates } from "@/lib/discovery-dates";
import type { DiscoveryPreferences } from "@/lib/discovery-preferences";
import { discoveryShareQuery } from "@/lib/discovery-share";
import { useLanguage } from "./LanguageProvider";

export function DiscoveryShare({ filters, favorites }: { filters: DiscoveryPreferences; favorites: readonly string[] }) {
  const { t } = useLanguage();
  const [consentedText, setConsentedText] = useState("");
  const [consentedArtists, setConsentedArtists] = useState("");
  const artistSelection = JSON.stringify(favorites);
  const includeText = Boolean(filters.query) && consentedText === filters.query;
  const includeArtists = filters.sort === "favorites" && consentedArtists === artistSelection;
  const [copiedQuery, setCopiedQuery] = useState("");
  const [fallback, setFallback] = useState<{ query: string; href: string }>();
  const query = discoveryShareQuery({ ...filters, query: includeText ? filters.query : "" }, includeArtists ? favorites : []);

  async function copyLink() {
    const url = new URL(window.location.pathname, window.location.origin);
    url.search = query;
    try {
      await navigator.clipboard.writeText(url.href);
      setFallback(undefined);
      setCopiedQuery(query);
    } catch {
      setCopiedQuery("");
      setFallback({ query, href: url.href });
    }
  }

  return <details className="discoveryDates">
    <summary>{t("shareDiscovery")}</summary>
    <p>{t("shareDiscoveryPrivacy")}</p>
    {!!filters.artistSelection?.length && <p>{t("shareMatchArtists")}</p>}
    {filters.query && filters.query.length <= 120 && <label className="discoveryWeekend">
      <input type="checkbox" checked={includeText} onChange={event => setConsentedText(event.target.checked ? filters.query : "")} />
      {t("shareDiscoveryText")}
    </label>}
    {filters.sort === "favorites" && favorites.length > 0 && favorites.length <= 100 && <label className="discoveryWeekend">
      <input type="checkbox" checked={includeArtists} onChange={event => setConsentedArtists(event.target.checked ? artistSelection : "")} />
      {t("shareDiscoveryArtists")}
    </label>}
    <button type="button" className="outlineButton" onClick={copyLink} disabled={reversedDiscoveryDates(filters)}>
      {t("copyDiscoveryLink")}
    </button>
    {fallback?.query === query && <input className="dateShareFallback" readOnly value={fallback.href}
      aria-label={t("copyDiscoveryLink")} onFocus={event => event.target.select()} />}
    <span role="status">{copiedQuery === query ? t("discoveryLinkCopied") : ""}</span>
  </details>;
}
