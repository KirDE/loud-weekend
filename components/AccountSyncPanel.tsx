"use client";
import { useEffect, useState } from "react";
import { readDiscoveryPreferences } from "@/lib/discovery-preferences";
import { readCollections, mergeCollections } from "@/lib/collections";
import { useLanguage } from "./LanguageProvider";
import { emptyPlannerState, type PlannerState, useLocalPlanner } from "./LocalPlanner";
type Kind = "favorites" | "collections" | "saved-filters" | "plans";
type Document = { id: string; payload: unknown; revision: number; updatedAt: string };
type Conflict = { kind: Kind; local: unknown; remote: Document };
const kinds: Kind[] = ["favorites", "collections", "saved-filters", "plans"];
const labels = {
  en: {
    title: "Account sync",
    local: "Your local plan remains available while signed out.",
    migrate: "Merge this device into my account",
    replace: "Use account data on this device",
    sync: "Sync now",
    syncing: "Syncing…",
    current: "Everything is synchronized.",
    resolved: "Conflict resolved. Sync again to send other local changes.",
    conflict: "A newer version exists on another device. Nothing was overwritten.",
    keepLocal: "Keep this device",
    keepRemote: "Use other device",
    share: "Create public plan link",
    expiry: "Link expiry",
    copy: "Copy link",
    copied: "Copied",
    expired: "Expired links return Not Found.",
    spotify: "Spotify",
    connect: "Connect or reconnect Spotify",
    import: "Import playlists",
    last: "Last successful import",
    imported: "Saved imported playlists",
    empty: "No imported playlists yet.",
    tracks: "tracks",
    failed: "Sync failed. Reconnect and try again.",
    login: "Sign in from the Account menu to enable cross-device sync.",
  },
  de: {
    title: "Konto-Synchronisierung",
    local: "Dein lokaler Plan bleibt ohne Anmeldung verfügbar.",
    migrate: "Dieses Gerät mit meinem Konto zusammenführen",
    replace: "Kontodaten auf diesem Gerät verwenden",
    sync: "Jetzt synchronisieren",
    syncing: "Synchronisiere…",
    current: "Alles ist synchronisiert.",
    resolved: "Konflikt gelöst. Synchronisiere erneut, um weitere lokale Änderungen zu übertragen.",
    conflict: "Auf einem anderen Gerät gibt es eine neuere Version. Nichts wurde überschrieben.",
    keepLocal: "Dieses Gerät behalten",
    keepRemote: "Anderes Gerät verwenden",
    share: "Öffentlichen Plan-Link erstellen",
    expiry: "Link-Ablauf",
    copy: "Link kopieren",
    copied: "Kopiert",
    expired: "Abgelaufene Links zeigen „Nicht gefunden“.",
    spotify: "Spotify",
    connect: "Spotify verbinden oder neu verbinden",
    import: "Playlists importieren",
    last: "Letzter erfolgreicher Import",
    imported: "Gespeicherte importierte Playlists",
    empty: "Noch keine Playlists importiert.",
    tracks: "Titel",
    failed: "Synchronisierung fehlgeschlagen. Neu verbinden und erneut versuchen.",
    login: "Im Konto-Menü anmelden, um geräteübergreifend zu synchronisieren.",
  },
  ru: {
    title: "Синхронизация аккаунта",
    local: "Без входа локальный план останется доступен.",
    migrate: "Объединить данные устройства с аккаунтом",
    replace: "Использовать данные аккаунта на устройстве",
    sync: "Синхронизировать",
    syncing: "Синхронизация…",
    current: "Всё синхронизировано.",
    resolved:
      "Конфликт решён. Запустите синхронизацию ещё раз, чтобы отправить остальные локальные изменения.",
    conflict: "На другом устройстве есть более новая версия. Ничего не перезаписано.",
    keepLocal: "Оставить данные устройства",
    keepRemote: "Взять данные другого устройства",
    share: "Создать публичную ссылку на план",
    expiry: "Срок ссылки",
    copy: "Копировать ссылку",
    copied: "Скопировано",
    expired: "Истёкшие ссылки возвращают «Не найдено».",
    spotify: "Spotify",
    connect: "Подключить или переподключить Spotify",
    import: "Импортировать плейлисты",
    last: "Последний успешный импорт",
    imported: "Сохранённые импортированные плейлисты",
    empty: "Плейлисты ещё не импортированы.",
    tracks: "треков",
    failed: "Ошибка синхронизации. Переподключитесь и повторите.",
    login: "Войдите через меню аккаунта, чтобы включить синхронизацию между устройствами.",
  },
} as const;
function playlistSelection(value: unknown) {
  const { playlistFestivals, playlistExcludedArtists } = readCollections(value);
  return { playlistFestivals, playlistExcludedArtists };
}
function payloads(p: ReturnType<typeof useLocalPlanner>): Record<Kind, unknown> {
  return {
    favorites: { favoriteFestivals: p.favoriteFestivals, favoriteArtists: p.favoriteArtists },
    collections: readCollections({
      playlistFestivals: p.playlistFestivals,
      playlistExcludedArtists: p.playlistExcludedArtists,
    }),
    "saved-filters": { savedFilters: p.savedFilters },
    plans: { attendance: p.attendance },
  };
}
function plannerFrom(documents: Partial<Record<Kind, Document>>): PlannerState {
  const value = (kind: Kind) => (documents[kind]?.payload || {}) as Partial<PlannerState>;
  return {
    ...emptyPlannerState,
    ...value("favorites"),
    ...playlistSelection(documents.collections?.payload),
    savedFilters: readDiscoveryPreferences(value("saved-filters").savedFilters),
    ...value("plans"),
  };
}
function mergePayload(kind: Kind, remote: unknown, local: unknown) {
  const a = remote as Partial<PlannerState>;
  const b = local as Partial<PlannerState>;
  if (kind === "favorites")
    return {
      favoriteFestivals: Array.from(
        new Set([...(a.favoriteFestivals || []), ...(b.favoriteFestivals || [])]),
      ),
      favoriteArtists: Array.from(
        new Set([...(a.favoriteArtists || []), ...(b.favoriteArtists || [])]),
      ),
    };
  if (kind === "collections") return mergeCollections(remote, local);
  if (kind === "plans") return { attendance: { ...a.attendance, ...b.attendance } };
  return { ...a, ...b };
}
export function AccountSyncPanel({
  disabled = false,
  onBusyChange,
}: { disabled?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const planner = useLocalPlanner();
  const { language, locale } = useLanguage();
  const t = labels[language];
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [docs, setDocs] = useState<Partial<Record<Kind, Document>>>({});
  const [busy, setBusyState] = useState(false);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [expiry, setExpiry] = useState("");
  function setBusy(value: boolean) {
    setBusyState(value);
    onBusyChange?.(value);
  }
  async function readDocuments() {
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const response = await fetch("/api/sync/" + kind, { cache: "no-store" });
        if (!response.ok) throw new Error(t.failed);
        const { document } = (await response.json()) as { document?: Document | null };
        if (
          document !== null &&
          (!document ||
            typeof document.id !== "string" ||
            !Number.isInteger(document.revision) ||
            document.revision < 0 ||
            document.payload === undefined)
        )
          throw new Error(t.failed);
        if (kind === "collections" && document) readCollections(document.payload);
        if (kind === "saved-filters" && document) {
          const filters = (document.payload as { savedFilters?: unknown } | null)?.savedFilters;
          if (!filters || typeof filters !== "object" || Array.isArray(filters))
            throw new Error(t.failed);
        }
        return [kind, document] as const;
      }),
    );
    return Object.fromEntries(entries.filter(([, document]) => document)) as Partial<
      Record<Kind, Document>
    >;
  }

  async function load() {
    try {
      const me = await fetch("/api/auth/me", { cache: "no-store" });
      if (!me.ok) {
        setUser(null);
        setDocs({});
        return;
      }
      setUser((await me.json()).user);
      setDocs({});
      setDocs(await readDocuments());
    } catch {
      setStatus(t.failed);
    }
  }

  useEffect(() => {
    void load();
    const listener = () => void load();
    window.addEventListener("loud-weekend-authenticated", listener);
    return () => window.removeEventListener("loud-weekend-authenticated", listener);
  }, []);
  async function put(kind: Kind, payload: unknown, revision: number) {
    const response = await fetch(`/api/sync/${kind}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload, revision }),
    });
    const body = await response.json();
    if (response.status === 409) {
      const latest = await fetch(`/api/sync/${kind}`, { cache: "no-store" }).then((value) =>
        value.json(),
      );
      setConflict({ kind, local: payload, remote: latest.document });
      throw new Error("conflict");
    }
    if (!response.ok) throw new Error(t.failed);
    setDocs((current) => ({ ...current, [kind]: body.document }));
    return body.document as Document;
  }
  async function synchronize(mode: "merge" | "remote" | "normal" = "normal") {
    setBusy(true);
    setStatus("");
    setConflict(null);
    try {
      if (mode === "remote") {
        const latest = await readDocuments();
        planner.replace(plannerFrom(latest));
        setDocs(latest);
        setStatus(t.current);
        return;
      }
      const local = payloads(planner),
        next = { ...docs };
      for (const kind of kinds) {
        const content =
          mode === "merge" && next[kind]
            ? mergePayload(kind, next[kind]!.payload, local[kind])
            : local[kind];
        next[kind] = await put(kind, content, next[kind]?.revision ?? 0);
      }
      if (mode === "merge") planner.merge(plannerFrom(next));
      setStatus(t.current);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message === "conflict"))
        setStatus(reason instanceof Error ? reason.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(useLocal: boolean) {
    if (!conflict) return;
    setBusy(true);
    try {
      const { kind, local, remote } = conflict;
      if (useLocal) {
        await put(kind, local, remote.revision);
      } else {
        const state = plannerFrom({ [kind]: remote });
        const fields = {
          favorites: {
            favoriteFestivals: state.favoriteFestivals,
            favoriteArtists: state.favoriteArtists,
          },
          collections: {
            playlistFestivals: state.playlistFestivals,
            playlistExcludedArtists: state.playlistExcludedArtists,
          },
          "saved-filters": { savedFilters: state.savedFilters },
          plans: { attendance: state.attendance },
        };
        planner.replaceFields(fields[kind]);
        setDocs((current) => ({ ...current, [kind]: remote }));
      }
      setConflict(null);
      setStatus(t.resolved);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    setStatus("");
    try {
      let plan = docs.plans;
      if (!plan) plan = await put("plans", payloads(planner).plans, 0);
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId: plan.id,
          expiresAt: expiry ? new Date(`${expiry}T23:59:59.999Z`).toISOString() : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(t.failed);
      setShareUrl(`${location.origin}/share/${body.share.slug}/`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  async function spotifySync() {
    setBusy(true);
    setStatus("");
    setConflict(null);
    try {
      // Preserve unsynchronized device selection first, under the same revision
      // checks as normal sync. A conflict aborts before calling the provider.
      const remoteCollections = readCollections(docs.collections?.payload);
      const selection = {
        ...mergeCollections(remoteCollections, { playlistFestivals: planner.playlistFestivals }),
        playlistExcludedArtists:
          planner.playlistExcludedArtists ?? remoteCollections.playlistExcludedArtists,
      };
      const saved = await put("collections", selection, docs.collections?.revision ?? 0);
      planner.merge(playlistSelection(saved.payload));
      const response = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: saved.revision }),
      });
      if (response.status === 409) {
        const latest = await fetch("/api/sync/collections", { cache: "no-store" });
        if (!latest.ok) throw new Error(t.failed);
        const document = (await latest.json()).document;
        if (!document) throw new Error(t.failed);
        readCollections(document.payload);
        setConflict({ kind: "collections", local: selection, remote: document });
        setStatus(t.conflict);
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(t.failed);
      readCollections(body.document.payload);
      setDocs((value) => ({ ...value, collections: body.document }));
      setStatus(t.current);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message === "conflict")) setStatus(t.failed);
    } finally {
      setBusy(false);
    }
  }
  const imported = readCollections(docs.collections?.payload).spotify;

  if (!user)
    return (
      <section className="plannerSection accountSync">
        <h2>{t.title}</h2>
        <p>{t.local}</p>
        <strong>{t.login}</strong>
      </section>
    );
  return (
    <section className="plannerSection accountSync" aria-busy={busy}>
      <div className="sectionHeading">
        <div>
          <div className="eyebrow">{user.email}</div>
          <h2>{t.title}</h2>
        </div>
        <span aria-live="polite">{busy ? t.syncing : status}</span>
      </div>
      <div className="syncActions">
        <button disabled={busy || disabled} onClick={() => synchronize("merge")}>
          {t.migrate}
        </button>
        <button
          disabled={busy || disabled || !Object.keys(docs).length}
          onClick={() => synchronize("remote")}
        >
          {t.replace}
        </button>
        <button disabled={busy || disabled} onClick={() => synchronize()}>
          {t.sync}
        </button>
      </div>
      {conflict && (
        <div className="syncConflict" role="alert">
          <strong>{t.conflict}</strong>
          <div>
            <button disabled={busy || disabled} onClick={() => resolve(true)}>
              {t.keepLocal}
            </button>
            <button disabled={busy || disabled} onClick={() => resolve(false)}>
              {t.keepRemote}
            </button>
          </div>
        </div>
      )}
      <div className="syncGrid">
        <div>
          <h3>{t.share}</h3>
          <label>
            {t.expiry}
            <input
              type="date"
              value={expiry}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </label>
          <button disabled={busy || disabled} onClick={share}>
            {t.share}
          </button>
          {shareUrl && (
            <div className="shareResult">
              <a href={shareUrl}>{shareUrl}</a>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(shareUrl);
                  setStatus(t.copied);
                }}
              >
                {t.copy}
              </button>
            </div>
          )}
          <small>{t.expired}</small>
        </div>
        <div>
          <h3>{t.spotify}</h3>
          <a className="outlineButton" href="/api/spotify/connect">
            {t.connect}
          </a>
          <button disabled={busy || disabled} onClick={spotifySync}>
            {t.import}
          </button>
          {imported ? (
            <div className="importedCollections">
              <p>
                {t.last}:{" "}
                <time dateTime={imported.syncedAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(imported.syncedAt))}
                </time>
              </p>
              <h4>{t.imported}</h4>
              <ul>
                {imported.playlists.map((playlist) => (
                  <li key={playlist.id}>
                    <a href={playlist.url} target="_blank" rel="noopener noreferrer">
                      {playlist.name}
                    </a>
                    <span>
                      {" "}
                      · {playlist.trackCount} {t.tracks}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>{t.empty}</p>
          )}
        </div>
      </div>
    </section>
  );
}
