"use client";

import { useState, type FormEvent } from "react";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: {
    report: "Report a correction",
    kind: "What needs correcting?",
    DATE: "Dates",
    LINEUP: "Lineup",
    TICKETS: "Tickets",
    IDENTITY: "Artist identity",
    source: "Official HTTPS source",
    notes: "Explanation (optional; no personal information)",
    send: "Send report",
    received: "Report received for editorial review. Nothing was published.",
    invalid:
      "Check the details and use an official source URL without query parameters or fragments.",
    limit: "Too many reports. Try again later.",
    failed: "Could not send the report. Try again later.",
  },
  de: {
    report: "Korrektur melden",
    kind: "Was muss korrigiert werden?",
    DATE: "Termine",
    LINEUP: "Line-up",
    TICKETS: "Tickets",
    IDENTITY: "Künstleridentität",
    source: "Offizielle HTTPS-Quelle",
    notes: "Erläuterung (optional; keine personenbezogenen Daten)",
    send: "Meldung senden",
    received: "Die Redaktion prüft die Meldung. Es wurde nichts veröffentlicht.",
    invalid:
      "Prüfe die Angaben und verwende eine offizielle Quell-URL ohne Abfrageparameter oder Fragmente.",
    limit: "Zu viele Meldungen. Versuche es später erneut.",
    failed: "Die Meldung konnte nicht gesendet werden. Versuche es später erneut.",
  },
  ru: {
    report: "Сообщить об ошибке",
    kind: "Что нужно исправить?",
    DATE: "Даты",
    LINEUP: "Лайнап",
    TICKETS: "Билеты",
    IDENTITY: "Идентификация артиста",
    source: "Официальный источник (HTTPS)",
    notes: "Пояснение (необязательно; без персональных данных)",
    send: "Отправить сообщение",
    received: "Сообщение передано редакции. Ничего не опубликовано.",
    invalid:
      "Проверьте данные и укажите ссылку на официальный источник без параметров или фрагмента.",
    limit: "Слишком много сообщений. Попробуйте позже.",
    failed: "Не удалось отправить сообщение. Попробуйте позже.",
  },
};

type Target =
  { target: "edition"; slug: string; year: number } | { target: "artist"; slug: string };

export function CorrectionReportForm({ identity }: { identity: Target }) {
  const { language } = useLanguage();
  const copy = labels[language];
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"received" | "invalid" | "limit" | "failed">();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setStatus(undefined);
    try {
      const fields = Object.fromEntries(new FormData(form));
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...identity,
          ...fields,
          ...(identity.target === "artist" ? { kind: "IDENTITY" } : {}),
        }),
      });
      if (response.status === 202) {
        setStatus("received");
        form.reset();
      } else {
        setStatus(
          response.status === 422 ? "invalid" : response.status === 429 ? "limit" : "failed",
        );
      }
    } catch {
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="correctionReport">
      <summary className="correctionReportSummary">{copy.report}</summary>
      <form className="correctionReportFields" onSubmit={submit}>
        {identity.target === "edition" ? (
          <label className="correctionReportLabel">
            {copy.kind}
            <select className="correctionReportInput" name="kind">
              <option value="DATE">{copy.DATE}</option>
              <option value="LINEUP">{copy.LINEUP}</option>
              <option value="TICKETS">{copy.TICKETS}</option>
            </select>
          </label>
        ) : (
          <p>{copy.IDENTITY}</p>
        )}
        <label className="correctionReportLabel">
          {copy.source}
          <input
            className="correctionReportInput"
            type="url"
            name="sourceUrl"
            maxLength={1024}
            required
          />
        </label>
        <label className="correctionReportLabel">
          {copy.notes}
          <textarea className="correctionReportInput" name="notes" rows={3} maxLength={500} />
        </label>
        <input name="website" type="text" hidden tabIndex={-1} autoComplete="off" />
        <button type="submit" className="outlineButton correctionReportSubmit" disabled={busy}>
          {copy.send}
        </button>
        <div role="status">{status && copy[status]}</div>
      </form>
    </details>
  );
}
