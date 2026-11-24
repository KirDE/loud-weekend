"use client";

import { useState, type FormEvent } from "react";
import type { readNewFestivalDraft } from "@/lib/submission-new-festival";
import type { SubmissionEditionLink } from "@/lib/submission-edition-link";
import { useLanguage } from "./LanguageProvider";

export type NewFestivalDraft = ReturnType<typeof readNewFestivalDraft>;
const labels = {
  en: {
    title: "Onboard a new festival",
    identity: "Official festival name",
    slug: "Catalogue slug",
    country: "Country code",
    website: "Canonical organizer website",
    source: "Official announcement URL",
    excerpt: "Announcement excerpt naming the festival, country and edition year",
    stage: "Save reviewed festival identity",
    publish: "Publish new festival for tracking",
    pending: "Saved for editorial review. Publishing only adds a tracked edition.",
    failed:
      "Could not save or publish. Check the evidence, supported country and possible duplicate festival.",
  },
  de: {
    title: "Neues Festival anlegen",
    identity: "Offizieller Festivalname",
    slug: "Katalog-Kennung",
    country: "Ländercode",
    website: "Offizielle Website des Veranstalters",
    source: "URL der offiziellen Ankündigung",
    excerpt: "Auszug aus der Ankündigung mit Festivalname, Land und Jahr",
    stage: "Geprüfte Festivalidentität speichern",
    publish: "Neues Festival zur Beobachtung veröffentlichen",
    pending:
      "Intern gespeichert. Die Veröffentlichung fügt nur eine Ausgabe zur Beobachtung hinzu.",
    failed:
      "Speichern oder Veröffentlichen fehlgeschlagen. Prüfe den Beleg, das Land und mögliche Duplikate.",
  },
  ru: {
    title: "Добавить новый фестиваль",
    identity: "Официальное название фестиваля",
    slug: "Идентификатор в каталоге",
    country: "Код страны",
    website: "Официальный сайт организатора",
    source: "URL официального объявления",
    excerpt: "Отрывок объявления с названием фестиваля, страной и годом выпуска",
    stage: "Сохранить проверенные данные фестиваля",
    publish: "Опубликовать новый фестиваль для отслеживания",
    pending:
      "Данные сохранены для редакции. При публикации добавляется только отслеживаемый выпуск.",
    failed: "Не удалось сохранить или опубликовать. Проверьте источник, страну и возможный дубль.",
  },
};

export function SubmissionNewFestival({
  reference,
  year,
  draft,
  onDraft,
  onLink,
}: {
  reference: string;
  year: number;
  draft?: NewFestivalDraft;
  onDraft: (value: NewFestivalDraft) => void;
  onLink: (link: SubmissionEditionLink) => void;
}) {
  const { language } = useLanguage();
  const t = labels[language];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function review(payload: object) {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/admin/submissions/${reference}/new-festival/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Festival review failed");
      const result = await response.json();
      if (result.state === "linked") onLink(result.link);
      else onDraft(result.draft);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function stage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void review({ action: "stage", ...Object.fromEntries(new FormData(event.currentTarget)) });
  }

  return (
    <details open={Boolean(draft) || undefined}>
      <summary>{t.title}</summary>
      <form onSubmit={stage}>
        <label>
          {t.identity}
          <input name="name" defaultValue={draft?.name} minLength={2} maxLength={100} required />
        </label>
        <label>
          {t.slug}
          <input
            name="slug"
            defaultValue={draft?.slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={100}
            required
          />
        </label>
        <label>
          {t.country}
          <input
            name="countryCode"
            defaultValue={draft?.countryCode}
            pattern="[A-Z]{2}"
            maxLength={2}
            required
          />
        </label>
        <label>
          {t.website}
          <input
            type="url"
            name="officialUrl"
            defaultValue={draft?.officialUrl}
            maxLength={500}
            required
          />
        </label>
        <label>
          {t.source}
          <input
            type="url"
            name="evidenceUrl"
            defaultValue={draft?.evidenceUrl}
            maxLength={500}
            required
          />
        </label>
        <label>
          {t.excerpt}
          <textarea
            name="excerpt"
            defaultValue={draft?.excerpt}
            minLength={8}
            maxLength={500}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {t.stage}
        </button>
      </form>
      {draft && (
        <>
          <p role="status">{t.pending}</p>
          <p>
            {draft.name} · {draft.slug} · {draft.countryCode} · {year}
          </p>
          <p>
            <a href={draft.officialUrl} target="_blank" rel="noreferrer">
              {draft.officialUrl}
            </a>
          </p>
          <p>
            <a href={draft.evidenceUrl} target="_blank" rel="noreferrer">
              {draft.evidenceUrl}
            </a>
          </p>
          <blockquote>{draft.excerpt}</blockquote>
          <button
            type="button"
            disabled={busy}
            onClick={() => void review({ action: "publish", draftId: draft.id })}
          >
            {t.publish}
          </button>
        </>
      )}
      {failed && <p role="alert">{t.failed}</p>}
    </details>
  );
}
