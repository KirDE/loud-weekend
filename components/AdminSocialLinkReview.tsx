"use client";

import { useState } from "react";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: {
    title: "Review a discovered social profile",
    choose: "Social profile",
    source: "Official evidence URL",
    verify: "Queue social profile for review",
    help: "Check that the artist’s verified official site links to this exact profile.",
  },
  de: {
    title: "Gefundenes Social-Media-Profil prüfen",
    choose: "Social-Media-Profil",
    source: "Offizielle Quell-URL",
    verify: "Social-Media-Profil zur Prüfung einreichen",
    help: "Prüfe, ob die verifizierte Website des Künstlers genau dieses Profil verlinkt.",
  },
  ru: {
    title: "Проверка найденного профиля в соцсетях",
    choose: "Профиль в соцсети",
    source: "URL официального источника",
    verify: "Отправить профиль на проверку",
    help: "Убедитесь, что подтверждённый сайт артиста ссылается именно на этот профиль.",
  },
};

export function AdminSocialLinkReview({
  candidates,
  onSave,
}: {
  candidates: string[];
  onSave: (proof: { url: string; sourceUrl: string; observedAt: string }) => Promise<void>;
}) {
  const { language } = useLanguage();
  const t = labels[language];
  const [url, setUrl] = useState(candidates[0] ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave({ url, sourceUrl, observedAt: new Date().toISOString() });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>{t.title}</h4>
      <p>{t.help}</p>
      <label>
        {t.choose}
        <select value={url} onChange={(event) => setUrl(event.target.value)}>
          {candidates.map((candidate) => (
            <option key={candidate}>{candidate}</option>
          ))}
        </select>
      </label>
      <label>
        {t.source}
        <input
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy || !url}>
        {t.verify}
      </button>
    </form>
  );
}
