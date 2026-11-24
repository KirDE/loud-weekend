"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: {
    heading: "Private calendar subscription",
    help:
      "Includes Going and Maybe festivals synced to this account. " +
      "Anyone with the link can read that calendar. " +
      "Your calendar app decides when to refresh.",
    create: "Create calendar link",
    rotate: "Replace calendar link",
    revoke: "Revoke calendar link",
    active: "A link is active. Replace it to get a new link and invalidate the old one.",
    link: "Calendar subscription URL",
    copy: "Copy calendar URL",
    copied: "Calendar URL copied.",
    unavailable: "New calendar subscriptions are not available.",
    failed: "Calendar subscription could not be updated.",
    retry: "Check subscription",
  },
  de: {
    heading: "Privates Kalenderabo",
    help:
      "Enthält mit diesem Konto synchronisierte Festivals " +
      "mit „Dabei“ oder „Vielleicht“. Wer den Link hat, kann den Kalender lesen. " +
      "Deine Kalender-App bestimmt, wann er aktualisiert wird.",
    create: "Kalenderlink erstellen",
    rotate: "Kalenderlink ersetzen",
    revoke: "Kalenderlink widerrufen",
    active: "Ein Link ist aktiv. Beim Ersetzen wird der alte Link ungültig.",
    link: "Adresse des Kalenderabos",
    copy: "Kalenderadresse kopieren",
    copied: "Kalenderadresse kopiert.",
    unavailable: "Neue Kalenderabos sind nicht verfügbar.",
    failed: "Das Kalenderabo konnte nicht aktualisiert werden.",
    retry: "Kalenderabo prüfen",
  },
  ru: {
    heading: "Приватная подписка на календарь",
    help:
      "Включает синхронизированные с аккаунтом " +
      "фестивали со статусом «Пойду» или «Возможно». Календарь доступен всем, у кого есть ссылка. " +
      "Частоту обновления определяет приложение календаря.",
    create: "Создать ссылку на календарь",
    rotate: "Заменить ссылку на календарь",
    revoke: "Отозвать ссылку на календарь",
    active: "Ссылка активна. При замене старая ссылка перестанет работать.",
    link: "Адрес подписки на календарь",
    copy: "Скопировать адрес календаря",
    copied: "Адрес календаря скопирован.",
    unavailable: "Создание подписок пока недоступно.",
    failed: "Не удалось обновить подписку на календарь.",
    retry: "Проверить подписку",
  },
};

const endpoint = "/api/calendar/subscription/";

export function CalendarSubscription({ disabled }: { disabled: boolean }) {
  const { language } = useLanguage();
  const t = labels[language];
  const [active, setActive] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"failed" | "copied" | null>(null);

  async function load(signal?: AbortSignal) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (typeof result.active !== "boolean" || typeof result.available !== "boolean")
        throw new Error();
      if (!signal?.aborted) {
        setActive(result.active);
        setAvailable(result.available);
      }
    } catch {
      if (!signal?.aborted) setFeedback("failed");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  async function change(method: "POST" | "DELETE") {
    setBusy(true);
    setFeedback(null);
    setUrl("");
    try {
      const response = await fetch(endpoint, { method, cache: "no-store" });
      if (!response.ok) throw new Error();
      const responseBody = await response.json();
      setActive(responseBody.active);
      if (method === "POST") {
        const feed = new URL("/api/calendar/feed/", location.origin);
        feed.searchParams.set("key", responseBody.key);
        setUrl(feed.toString());
      }
    } catch {
      // The write may have reached the server. Recheck before offering another change.
      setActive(null);
      setFeedback("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-busy={busy}>
      <h3>{t.heading}</h3>
      <p>{t.help}</p>
      {active === null ? (
        !busy && (
          <button type="button" disabled={disabled} onClick={() => void load()}>
            {t.retry}
          </button>
        )
      ) : (
        <>
          {active && !url && <p>{t.active}</p>}
          {available ? (
            <button type="button" disabled={disabled || busy} onClick={() => void change("POST")}>
              {active ? t.rotate : t.create}
            </button>
          ) : (
            <p>{t.unavailable}</p>
          )}
          {active && (
            <button type="button" disabled={disabled || busy} onClick={() => void change("DELETE")}>
              {t.revoke}
            </button>
          )}
        </>
      )}
      {url && (
        <>
          <label>
            {t.link}
            <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setFeedback("copied");
              } catch {
                setFeedback("failed");
              }
            }}
          >
            {t.copy}
          </button>
        </>
      )}
      {feedback && <p role="status">{t[feedback]}</p>}
    </div>
  );
}
