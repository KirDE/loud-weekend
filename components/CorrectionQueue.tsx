"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLanguage } from "./LanguageProvider";

type Decision = "ACCEPTED" | "DISMISSED";
type Report = {
  id: string;
  targetName: string;
  editionYear: number | null;
  kind: "DATE" | "LINEUP" | "TICKETS" | "IDENTITY";
  sourceUrl: string;
  notes: string | null;
  status: "PENDING" | Decision;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerId: string | null;
};

export const correctionQueueLabel = {
  en: "Correction reports",
  de: "Korrekturmeldungen",
  ru: "Сообщения об ошибках",
};
const labels = {
  en: {
    back: "Back to administration",
    empty: "No correction reports.",
    info: "Accepting a report does not change the catalogue.",
    DATE: "Dates",
    LINEUP: "Lineup",
    TICKETS: "Tickets",
    IDENTITY: "Identity",
    PENDING: "Pending",
    ACCEPTED: "Accepted",
    DISMISSED: "Dismissed",
    pending: "Pending reports",
    reviewed: "Review history",
    previous: "Previous",
    next: "Next",
    accept: "Accept for follow-up",
    dismiss: "Dismiss",
    failed: "The decision could not be saved. Refresh and try again.",
  },
  de: {
    back: "Zurück zur Verwaltung",
    empty: "Keine Korrekturmeldungen.",
    info: "Eine angenommene Meldung ändert den Katalog nicht.",
    DATE: "Termine",
    LINEUP: "Line-up",
    TICKETS: "Tickets",
    IDENTITY: "Identität",
    PENDING: "Offen",
    ACCEPTED: "Angenommen",
    DISMISSED: "Verworfen",
    pending: "Offene Meldungen",
    reviewed: "Entscheidungsverlauf",
    previous: "Zurück",
    next: "Weiter",
    accept: "Zur Bearbeitung annehmen",
    dismiss: "Verwerfen",
    failed: "Die Entscheidung konnte nicht gespeichert werden. Lade die Seite neu.",
  },
  ru: {
    back: "Назад в админку",
    empty: "Сообщений об ошибках нет.",
    info: "Принятие сообщения не меняет каталог.",
    DATE: "Даты",
    LINEUP: "Лайнап",
    TICKETS: "Билеты",
    IDENTITY: "Идентификация",
    PENDING: "Ожидает",
    ACCEPTED: "Принято",
    DISMISSED: "Отклонено",
    pending: "Ожидающие сообщения",
    reviewed: "История решений",
    previous: "Назад",
    next: "Далее",
    accept: "Принять в работу",
    dismiss: "Отклонить",
    failed: "Не удалось сохранить решение. Обновите страницу и повторите попытку.",
  },
};

export function CorrectionQueue({
  reports,
  reviewed,
  page,
  lastPage,
}: {
  reports: Report[];
  reviewed: boolean;
  page: number;
  lastPage: number;
}) {
  const { language, locale } = useLanguage();
  const copy = labels[language];
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState(false);
  const link = (page: number) =>
    `/admin/corrections/?view=${reviewed ? "reviewed" : "pending"}&page=${page}`;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  async function decide(id: string, status: Decision) {
    setBusy(id);
    setFailed(false);
    try {
      const response = await fetch(`/api/admin/corrections/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Decision failed");
      router.push("/admin/corrections/?view=reviewed");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="correctionQueue">
      <Link className="correctionQueueLink" href="/admin/">
        {copy.back}
      </Link>
      <h1>{correctionQueueLabel[language]}</h1>
      <p>{copy.info}</p>
      <nav className="correctionQueueNav" aria-label={correctionQueueLabel[language]}>
        <Link
          className="correctionQueueLink"
          href="/admin/corrections/"
          aria-current={!reviewed ? "page" : undefined}
        >
          {copy.pending}
        </Link>
        <Link
          className="correctionQueueLink"
          href="/admin/corrections/?view=reviewed"
          aria-current={reviewed ? "page" : undefined}
        >
          {copy.reviewed}
        </Link>
      </nav>
      {failed && <p role="alert">{copy.failed}</p>}
      {!reports.length && <p>{copy.empty}</p>}
      <div className="reviewList">
        {reports.map((report) => (
          <article className="reviewCard" key={report.id}>
            <h2>
              {report.targetName}
              {report.editionYear ? ` · ${report.editionYear}` : ""}
            </h2>
            <p>
              {copy[report.kind]} · {copy[report.status]} ·{" "}
              <time dateTime={report.submittedAt}>
                {date.format(new Date(report.submittedAt))} UTC
              </time>
            </p>
            <p>{report.sourceUrl}</p>
            {report.notes && <p>{report.notes}</p>}
            {report.status === "PENDING" ? (
              <div className="reviewActions">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => decide(report.id, "ACCEPTED")}
                >
                  {copy.accept}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => decide(report.id, "DISMISSED")}
                >
                  {copy.dismiss}
                </button>
              </div>
            ) : (
              report.reviewedAt && (
                <small>
                  <time dateTime={report.reviewedAt}>
                    {date.format(new Date(report.reviewedAt))} UTC
                  </time>{" "}
                  · {report.reviewerId}
                </small>
              )
            )}
          </article>
        ))}
      </div>
      {lastPage > 1 && (
        <nav className="correctionQueueNav" aria-label={reviewed ? copy.reviewed : copy.pending}>
          {page > 1 && (
            <Link className="correctionQueueLink" href={link(page - 1)}>
              {copy.previous}
            </Link>
          )}
          <span>
            {page} / {lastPage}
          </span>
          {page < lastPage && (
            <Link className="correctionQueueLink" href={link(page + 1)}>
              {copy.next}
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
