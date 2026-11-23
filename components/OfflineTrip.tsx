"use client";

import { useEffect, useState } from "react";
import { fetchOfflineTrip, offlineTripCopy, offlineTripKey, readOfflineTrip, saveOfflineTrip, type OfflineTrip, type OfflineTripRecord } from "@/public/offline-trips.mjs";
import { useLanguage } from "./LanguageProvider";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function OfflineTripDownload({ slug, year }: { slug: string; year: number }) {
  const { language, locale } = useLanguage();
  const t = offlineTripCopy[language];
  const [record, setRecord] = useState<OfflineTripRecord | null>(null);
  const [notice, setNotice] = useState<"saved" | "removed" | "unavailable" | "storage" | null>(null);
  const [busy, setBusy] = useState(false);
  const key = offlineTripKey(slug, year);

  useEffect(() => {
    const read = () => {
      try { setRecord(readOfflineTrip(localStorage, slug, year)); }
      catch { setNotice("storage"); }
    };
    read();
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) read();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key, slug, year]);

  async function download() {
    setBusy(true);
    setNotice(null);
    try {
      let trip: OfflineTrip;
      try {
        trip = await fetchOfflineTrip(basePath, slug, year);
      } catch {
        return setNotice("unavailable");
      }
      try {
        setRecord(saveOfflineTrip(localStorage, trip));
        setNotice("saved");
      } catch {
        setNotice("storage");
      }
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    try {
      localStorage.removeItem(key);
      setRecord(null);
      setNotice("removed");
    } catch {
      setNotice("storage");
    }
  }

  return <section className="offlineTrip">
    <h2>{t.heading}</h2>
    {record && <p>{t.savedAt}: <time dateTime={record.savedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.savedAt))}</time>. {t.stale}</p>}
    <div className="localActions">
      <button type="button" className="outlineButton" disabled={busy} onClick={download}>{busy ? t.pending : record ? t.update : t.save}</button>
      {record && <button type="button" className="outlineButton" disabled={busy} onClick={remove}>{t.remove}</button>}
      <a href={`${basePath}/offline.html#trips`}>{t.open}</a>
    </div>
    {notice && <p role="status">{t[notice]}</p>}
  </section>;
}
