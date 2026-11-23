"use client";

import { useState, type FormEvent } from "react";
import type { readFollowOnDraft } from "@/lib/submission-follow-on-edition";
import type { SubmissionEditionLink } from "@/lib/submission-edition-link";
import { useLanguage } from "./LanguageProvider";

export type FollowOnDraft = ReturnType<typeof readFollowOnDraft>;
const copy = {
  en: {
    title: "Onboard an announced future edition",
    festival: "Existing festival",
    choose: "Choose a festival",
    url: "Official announcement URL",
    excerpt: "Announcement excerpt with the festival name and year",
    stage: "Save reviewed evidence",
    publish: "Publish the tracked edition",
    staged: "Evidence saved privately. Publishing adds only the edition to future tracking.",
    failed:
      "Could not save the review or publish the edition. Check the organizer site, festival and year.",
  },
  de: {
    title: "Angekündigte künftige Ausgabe anlegen",
    festival: "Vorhandenes Festival",
    choose: "Festival auswählen",
    url: "URL der offiziellen Ankündigung",
    excerpt: "Auszug aus der Ankündigung mit Festivalname und Jahr",
    stage: "Geprüften Beleg speichern",
    publish: "Ausgabe zur Beobachtung veröffentlichen",
    staged:
      "Der Beleg ist intern gespeichert. Nur die künftige Ausgabe wird zur Beobachtung veröffentlicht.",
    failed:
      "Prüfung oder Veröffentlichung fehlgeschlagen. Prüfe die Veranstalterseite, das Festival und das Jahr.",
  },
  ru: {
    title: "Добавить объявленный будущий выпуск",
    festival: "Существующий фестиваль",
    choose: "Выберите фестиваль",
    url: "URL официального объявления",
    excerpt: "Отрывок объявления с названием фестиваля и годом",
    stage: "Сохранить проверенный источник",
    publish: "Опубликовать отслеживаемый выпуск",
    staged:
      "Источник сохранён для редакции. При публикации добавляется только запись о будущем выпуске.",
    failed:
      "Не удалось сохранить проверку или опубликовать выпуск. Проверьте сайт организатора, фестиваль и год.",
  },
};

export function SubmissionFollowOnEdition({
  reference,
  year,
  options,
  draft,
  onDraft,
  onLink,
}: {
  reference: string;
  year: number;
  options: { slug: string; name: string; year: number }[];
  draft?: FollowOnDraft;
  onDraft: (value: FollowOnDraft) => void;
  onLink: (value: SubmissionEditionLink) => void;
}) {
  const { language } = useLanguage();
  const t = copy[language];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const festivals = options.filter(
    (item) =>
      item.year < year &&
      !options.some((other) => other.slug === item.slug && other.year > item.year),
  );
  if (!festivals.length) return null;

  async function save(body: object) {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/admin/submissions/${reference}/follow-on/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Edition review failed");
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
    return save({ action: "stage", ...Object.fromEntries(new FormData(event.currentTarget)) });
  }

  return (
    <details open={Boolean(draft) || undefined}>
      <summary>{t.title}</summary>
      <form onSubmit={stage}>
        <label>
          {t.festival}
          <select name="slug" defaultValue={draft?.slug ?? ""} required>
            <option value="" disabled>
              {t.choose}
            </option>
            {festivals.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.url}
          <input
            name="evidenceUrl"
            type="url"
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
          <p role="status">{t.staged}</p>
          <p>
            {draft.slug} · {year} ·{" "}
            <a href={draft.evidenceUrl} rel="noreferrer" target="_blank">
              {draft.evidenceUrl}
            </a>
          </p>
          <blockquote>{draft.excerpt}</blockquote>
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ action: "publish", draftId: draft.id })}
          >
            {t.publish}
          </button>
        </>
      )}
      {failed && <p role="alert">{t.failed}</p>}
    </details>
  );
}
