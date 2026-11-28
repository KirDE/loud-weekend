"use client";

import { useId, useState } from "react";
import {
  dateShareQuery,
  hasDiscoveryDates,
  readDiscoveryDates,
  reversedDiscoveryDates,
  type DiscoveryDates,
} from "@/lib/discovery-dates";
import { useLanguage } from "./LanguageProvider";

export function DiscoveryDateFilters({
  filters,
  onChange,
}: {
  filters: DiscoveryDates;
  onChange: (patch: Partial<DiscoveryDates>) => void;
}) {
  const { t } = useLanguage();
  const hintId = useId();
  const active = hasDiscoveryDates(filters);
  const reversed = reversedDiscoveryDates(filters);
  const shareQuery = dateShareQuery(filters);

  return (
    <details className="discoveryDates" open={active || undefined}>
      <summary>{t("dateFilters")}</summary>
      <fieldset aria-describedby={hintId}>
        <legend className="srOnly">{t("dateFilters")}</legend>
        <label>
          {t("dateFrom")}
          <input
            type="date"
            value={filters.dateFrom}
            aria-invalid={reversed}
            onChange={(event) =>
              onChange({ dateFrom: readDiscoveryDates({ dateFrom: event.target.value }).dateFrom })
            }
          />
        </label>
        <label>
          {t("dateTo")}
          <input
            type="date"
            value={filters.dateTo}
            aria-invalid={reversed}
            onChange={(event) =>
              onChange({ dateTo: readDiscoveryDates({ dateTo: event.target.value }).dateTo })
            }
          />
        </label>
        <label>
          {t("dateMaxDays")}
          <input
            type="number"
            min="1"
            max="99"
            step="1"
            inputMode="numeric"
            placeholder={t("dateAnyDuration")}
            value={filters.maxDays === "all" ? "" : filters.maxDays}
            onChange={(event) =>
              onChange({ maxDays: readDiscoveryDates({ maxDays: event.target.value }).maxDays })
            }
          />
        </label>
        <label className="discoveryWeekend">
          <input
            type="checkbox"
            checked={filters.weekendOnly}
            onChange={(event) => onChange({ weekendOnly: event.target.checked })}
          />
          {t("dateWeekend")}
        </label>
      </fieldset>
      <p id={hintId}>{reversed ? t("dateReversed") : t("dateUnknownExcluded")}</p>
      {active && !reversed && <DateShareControls key={shareQuery} query={shareQuery} />}
    </details>
  );
}

function DateShareControls({ query }: { query: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [fallbackLink, setFallbackLink] = useState("");

  async function copyLink() {
    const url = new URL(window.location.pathname, window.location.origin);
    url.search = query;
    try {
      await navigator.clipboard.writeText(url.href);
      setFallbackLink("");
      setCopied(true);
    } catch {
      setCopied(false);
      setFallbackLink(url.href);
    }
  }

  return (
    <>
      <button type="button" className="outlineButton" onClick={copyLink}>
        {t("copyDateFilters")}
      </button>
      {fallbackLink && (
        <input
          className="dateShareFallback"
          aria-label={t("copyDateFilters")}
          readOnly
          value={fallbackLink}
          onFocus={(event) => event.target.select()}
        />
      )}
      <span role="status">{copied ? t("dateFiltersCopied") : ""}</span>
    </>
  );
}
