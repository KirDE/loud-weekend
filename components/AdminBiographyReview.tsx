"use client";

import { useState } from "react";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: {
    title: "Review an artist biography",
    summary: "Biography summary",
    evidence: "Official evidence URL",
    help: "Write a short summary in your own words using facts from the artist’s verified website.",
    submit: "Queue biography for review",
  },
  de: {
    title: "Künstlerbiografie prüfen",
    summary: "Kurze Biografie",
    evidence: "Offizielle Quell-URL",
    help: "Fasse belegte Fakten von der verifizierten Website in eigenen Worten zusammen.",
    submit: "Biografie zur Prüfung einreichen",
  },
  ru: {
    title: "Проверка биографии артиста",
    summary: "Краткая биография",
    evidence: "URL официального источника",
    help: "Кратко изложите своими словами факты с подтверждённого сайта артиста.",
    submit: "Отправить биографию на проверку",
  },
};

export function AdminBiographyReview({
  biography,
  onSave,
}: {
  biography?: string;
  onSave: (proof: { text: string; sourceUrl: string; observedAt: string }) => Promise<void>;
}) {
  const { language } = useLanguage();
  const t = labels[language];
  const [busy, setBusy] = useState(false);
  return (
    <form
      aria-labelledby="artist-biography-review"
      onSubmit={async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const text = String(fields.get("summary") ?? "")
          .replace(/\s+/g, " ")
          .trim();
        const sourceUrl = String(fields.get("evidence") ?? "").trim();
        if (!text || !sourceUrl) return;
        setBusy(true);
        try {
          await onSave({ text, sourceUrl, observedAt: new Date().toISOString() });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4 id="artist-biography-review">{t.title}</h4>
      <p>{t.help}</p>
      <label>
        {t.summary}
        <textarea name="summary" rows={4} maxLength={1200} defaultValue={biography} required />
      </label>
      <label>
        {t.evidence}
        <input name="evidence" type="url" maxLength={2048} required />
      </label>
      <button type="submit" disabled={busy}>
        {t.submit}
      </button>
    </form>
  );
}
