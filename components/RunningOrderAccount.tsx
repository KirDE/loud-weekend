"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";

const copy = {
  en: {
    title: "Private account copy",
    check: "Check account copy",
    save: "Save device selection to account",
    restore: "Replace device selection with account copy",
    clear: "Clear account copy",
    hint: "Nothing syncs automatically. Restore replaces this device’s selection, available even when signed out.",
    count: (count: number) => `Saved performances: ${count}`,
    login: "Sign in from the Account menu to use an account copy.",
    changed: "The account or saved copy changed. Check it again; no selection was replaced.",
    failed: "Could not complete the account action.",
    saved: "Account copy saved.",
    restored: "Device selection replaced.",
    cleared: "Account copy cleared.",
  },
  de: {
    title: "Private Kontokopie",
    check: "Kontokopie prüfen",
    save: "Geräteauswahl im Konto speichern",
    restore: "Geräteauswahl durch Kontokopie ersetzen",
    clear: "Kontokopie leeren",
    hint: "Beim Wiederherstellen wird die Geräteauswahl ersetzt. Sie bleibt auch ohne Anmeldung verfügbar.",
    count: (count: number) => `Gespeicherte Auftritte: ${count}`,
    login: "Melde dich im Konto-Menü an, um eine Kontokopie zu nutzen.",
    changed:
      "Das Konto oder die Kopie hat sich geändert. Prüfe sie erneut; keine Auswahl wurde ersetzt.",
    failed: "Die Kontoaktion konnte nicht abgeschlossen werden.",
    saved: "Kontokopie gespeichert.",
    restored: "Geräteauswahl ersetzt.",
    cleared: "Kontokopie geleert.",
  },
  ru: {
    title: "Личная копия в аккаунте",
    check: "Проверить копию в аккаунте",
    save: "Сохранить выбор устройства в аккаунте",
    restore: "Заменить выбор на устройстве копией из аккаунта",
    clear: "Очистить копию в аккаунте",
    hint: "Восстановление заменяет выбор на устройстве. Он доступен и после выхода.",
    count: (count: number) => `Сохранённые выступления: ${count}`,
    login: "Войдите через меню аккаунта, чтобы использовать личную копию.",
    changed: "Аккаунт или копия изменились. Проверьте их снова; выбор не был заменён.",
    failed: "Не удалось выполнить действие с аккаунтом.",
    saved: "Копия сохранена в аккаунте.",
    restored: "Выбор на устройстве заменён.",
    cleared: "Копия в аккаунте очищена.",
  },
};

type Snapshot = {
  account: { id: string; email: string };
  revision: number;
  count: number;
};
type AccountResponse = {
  account: Snapshot["account"];
  copy: { revision: number; performanceIds: string[] };
};

export function RunningOrderAccount({
  slug,
  year,
  selected,
  replace,
}: {
  slug: string;
  year: number;
  selected: string[];
  replace: (ids: string[]) => boolean;
}) {
  const { language } = useLanguage();
  const t = copy[language];
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<
    "login" | "changed" | "failed" | "saved" | "restored" | "cleared"
  >();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const reset = () => {
      active.current?.abort();
      active.current = null;
      setSnapshot(null);
      setStatus(undefined);
      setBusy(false);
    };
    window.addEventListener("loud-weekend-authenticated", reset);
    window.addEventListener("loud-weekend-signed-out", reset);
    setReady(true);
    return () => {
      active.current?.abort();
      window.removeEventListener("loud-weekend-authenticated", reset);
      window.removeEventListener("loud-weekend-signed-out", reset);
    };
  }, []);

  async function run(action: "check" | "save" | "restore" | "clear") {
    if (active.current || (action !== "check" && !snapshot)) return;
    const request = new AbortController();
    active.current = request;
    setBusy(true);
    setStatus(undefined);
    try {
      const write = snapshot && (action === "save" || action === "clear");
      const response = await fetch(`/api/running-order/${encodeURIComponent(slug)}/${year}/`, {
        cache: "no-store",
        signal: request.signal,
        ...(write && {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: snapshot.account.id,
            revision: snapshot.revision,
            performanceIds: action === "clear" ? [] : selected,
          }),
        }),
      });
      const data = await response.json();
      if (request.signal.aborted) return;
      if (response.status === 401 || response.status === 409) {
        setSnapshot(null);
        setStatus(response.status === 401 ? "login" : "changed");
        return;
      }
      if (!response.ok) throw new Error("Account action failed");
      if (write) {
        setSnapshot({
          account: snapshot.account,
          revision: data.copy.revision,
          count: data.copy.performanceIds.length,
        });
        setStatus(action === "clear" ? "cleared" : "saved");
        return;
      }
      const { account, copy }: AccountResponse = data;
      if (action === "restore") {
        if (snapshot?.account.id !== account.id || snapshot.revision !== copy.revision) {
          setSnapshot(null);
          setStatus("changed");
          return;
        }
        setStatus(replace(copy.performanceIds) ? "restored" : "failed");
      }
      setSnapshot({ account, revision: copy.revision, count: copy.performanceIds.length });
    } catch {
      if (!request.signal.aborted) setStatus("failed");
    } finally {
      if (active.current === request) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <details className="runningOrderAccount">
      <summary>{t.title}</summary>
      <p>{t.hint}</p>
      <button type="button" onClick={() => void run("check")} disabled={!ready || busy}>
        {t.check}
      </button>
      {snapshot && (
        <>
          <p className="runningOrderAccountIdentity">
            {snapshot.account.email} · {t.count(snapshot.count)}
          </p>
          <div className="runningOrderAccountActions">
            <button
              type="button"
              disabled={busy || !selected.length}
              onClick={() => void run("save")}
            >
              {t.save}
            </button>
            <button
              type="button"
              disabled={busy || !snapshot.count}
              onClick={() => void run("restore")}
            >
              {t.restore}
            </button>
            <button
              type="button"
              disabled={busy || !snapshot.count}
              onClick={() => void run("clear")}
            >
              {t.clear}
            </button>
          </div>
        </>
      )}
      <p aria-live="polite">{status ? t[status] : ""}</p>
    </details>
  );
}
