"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLanguage } from "./LanguageProvider";

type Choice = "GOING" | "MAYBE" | "NOT_GOING";
type Role = "OWNER" | "VIEWER" | "VOTER";
type Summary = { id: string; title: string };
type Index = { trips: Summary[]; editions: { id: string; name: string; year: number }[] };
type Trip = Summary & {
  role: Role;
  options: {
    editionId: string;
    name: string;
    year: number;
    ownVote: Choice | null;
    tally: Partial<Record<Choice, number>>;
  }[];
  invites?: {
    id: string;
    role: Exclude<Role, "OWNER">;
    expiresAt: string;
    claimedAt: string | null;
  }[];
  audit?: { action: "CREATED" | "INVITED" | "JOINED" | "REVOKED"; createdAt: string }[];
};

const choices: readonly Choice[] = ["GOING", "MAYBE", "NOT_GOING"];
const labels = {
  en: {
    title: "Group trips",
    intro:
      "Plan with invited accounts. Group trips do not share your private plan, favorites or connected accounts.",
    back: "Personal plan",
    auth: "Sign in to create or join a group trip.",
    load: "Loading…",
    error: "Could not complete that action. Check access and try again.",
    create: "Create trip",
    name: "Trip name",
    editions: "Choose up to 12 editions",
    join: "Join trip",
    code: "Invitation code",
    open: "Open group trip",
    refresh: "Refresh trip",
    votes: "Votes",
    none: "No vote",
    GOING: "Going",
    MAYBE: "Maybe",
    NOT_GOING: "Not going",
    VIEWER: "View only",
    VOTER: "Can vote",
    OWNER: "Owner",
    invite: "Create invitation",
    role: "Invitation role",
    secret: "Copy this one-time code to share privately. It expires after seven days.",
    expiry: "Expires",
    joined: "Accepted",
    revoke: "Revoke",
    invitations: "Invitations",
    audit: "Recent activity",
    CREATED: "Trip created",
    INVITED: "Invitation created",
    JOINED: "Invitation accepted",
    REVOKED: "Access revoked",
    leave: "Leave trip",
    remove: "Delete trip",
    removePrompt: "Delete this trip for everyone? This removes all invitations and votes.",
  },
  de: {
    title: "Gruppenreisen",
    intro:
      "Plane mit eingeladenen Konten. Dein privater Plan, deine Favoriten und verbundenen Konten bleiben privat.",
    back: "Persönlicher Plan",
    auth: "Melde dich an, um eine Gruppenreise zu erstellen oder ihr beizutreten.",
    load: "Wird geladen…",
    error:
      "Die Aktion konnte nicht abgeschlossen werden. Prüfe den Zugriff und versuche es erneut.",
    create: "Reise erstellen",
    name: "Name der Reise",
    editions: "Bis zu 12 Ausgaben auswählen",
    join: "Reise beitreten",
    code: "Einladungscode",
    open: "Gruppenreise öffnen",
    refresh: "Reise aktualisieren",
    votes: "Stimmen",
    none: "Keine Stimme",
    GOING: "Dabei",
    MAYBE: "Vielleicht",
    NOT_GOING: "Nicht dabei",
    VIEWER: "Nur ansehen",
    VOTER: "Darf abstimmen",
    OWNER: "Verantwortlich",
    invite: "Einladung erstellen",
    role: "Berechtigung",
    secret: "Kopiere diesen einmaligen Code und teile ihn privat. Er läuft nach sieben Tagen ab.",
    expiry: "Läuft ab",
    joined: "Angenommen",
    revoke: "Widerrufen",
    invitations: "Einladungen",
    audit: "Letzte Aktivitäten",
    CREATED: "Reise erstellt",
    INVITED: "Einladung erstellt",
    JOINED: "Einladung angenommen",
    REVOKED: "Zugriff widerrufen",
    leave: "Reise verlassen",
    remove: "Reise löschen",
    removePrompt: "Diese Reise für alle löschen? Einladungen und Stimmen werden entfernt.",
  },
  ru: {
    title: "Групповые поездки",
    intro:
      "Планируйте с приглашёнными участниками. Личный план, избранное и подключённые аккаунты не раскрываются.",
    back: "Личный план",
    auth: "Войдите, чтобы создать поездку или присоединиться к ней.",
    load: "Загрузка…",
    error: "Не удалось выполнить действие. Проверьте доступ и повторите попытку.",
    create: "Создать поездку",
    name: "Название поездки",
    editions: "Выберите не более 12 выпусков",
    join: "Присоединиться",
    code: "Код приглашения",
    open: "Открыть поездку",
    refresh: "Обновить поездку",
    votes: "Голоса",
    none: "Без голоса",
    GOING: "Пойду",
    MAYBE: "Возможно",
    NOT_GOING: "Не пойду",
    VIEWER: "Только просмотр",
    VOTER: "Может голосовать",
    OWNER: "Владелец",
    invite: "Создать приглашение",
    role: "Роль приглашённого",
    secret: "Скопируйте одноразовый код и передайте его лично. Срок действия — семь дней.",
    expiry: "Действует до",
    joined: "Принято",
    revoke: "Отозвать",
    invitations: "Приглашения",
    audit: "Последние действия",
    CREATED: "Поездка создана",
    INVITED: "Приглашение создано",
    JOINED: "Приглашение принято",
    REVOKED: "Доступ отозван",
    leave: "Покинуть поездку",
    remove: "Удалить поездку",
    removePrompt: "Удалить поездку для всех? Все приглашения и голоса будут удалены.",
  },
} as const;

async function response<T>(query = "", body?: object): Promise<T> {
  const res = await fetch("/api/group-trips/" + query, {
    cache: "no-store",
    credentials: "same-origin",
    ...(body && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) throw res.status;
  return res.json();
}

export function GroupTrips() {
  const { language, locale } = useLanguage();
  const t = labels[language];
  const [index, setIndex] = useState<Index | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<"busy" | "auth" | "error" | "ready">("busy");
  const authRevision = useRef(0);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );

  useEffect(() => {
    async function load() {
      const revision = ++authRevision.current;
      setIndex(null);
      setTrip(null);
      setSecret("");
      setStatus("busy");
      try {
        const next = await response<Index>();
        if (authRevision.current !== revision) return;
        setIndex(next);
        setStatus("ready");
      } catch (error) {
        if (authRevision.current === revision) setStatus(error === 401 ? "auth" : "error");
      }
    }
    void load();
    window.addEventListener("loud-weekend-authenticated", load);
    window.addEventListener("loud-weekend-signed-out", load);
    return () => {
      ++authRevision.current;
      window.removeEventListener("loud-weekend-authenticated", load);
      window.removeEventListener("loud-weekend-signed-out", load);
    };
  }, []);

  async function perform(
    body: object | undefined,
    nextTripId: string | undefined,
    reloadIndex = false,
  ) {
    const revision = ++authRevision.current;
    setStatus("busy");
    setSecret("");
    try {
      const result = body ? await response<{ id?: string; secret?: string }>("", body) : {};
      if (reloadIndex) {
        const updated = await response<Index>();
        if (authRevision.current !== revision) return;
        setIndex(updated);
      }
      const tripId = nextTripId ?? (reloadIndex ? result.id : undefined);
      const selected = tripId ? await response<Trip>(`?trip=${encodeURIComponent(tripId)}`) : null;
      if (authRevision.current !== revision) return;
      setTrip(selected);
      setSecret(result.secret ?? "");
      setStatus("ready");
    } catch (error) {
      if (authRevision.current !== revision) return;
      if (error === 401) setIndex(null);
      if (error === 401 || error === 404 || nextTripId !== trip?.id) setTrip(null);
      setStatus(error === 401 ? "auth" : "error");
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void perform(
      { kind: "create", title: data.get("title"), editionIds: data.getAll("edition") },
      undefined,
      true,
    );
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget;
    const code = new FormData(input).get("code")?.toString().trim();
    input.reset();
    void perform({ kind: "accept", secret: code }, undefined, true);
  }

  return (
    <div className="directoryPage groupTrips">
      <Link className="back" href={`/${language}/planner/`}>
        {t.back}
      </Link>
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <p role="status">
        {status === "auth"
          ? t.auth
          : status === "error"
            ? t.error
            : status === "busy"
              ? t.load
              : ""}
      </p>
      {index && (
        <fieldset disabled={status === "busy"}>
          <label>
            {t.open}
            <select
              value={trip?.id ?? ""}
              onChange={({ target }) => void perform(undefined, target.value || undefined)}
            >
              <option value="">—</option>
              {index.trips.map(({ id, title }) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          {trip && (
            <section aria-label={trip.title}>
              <h2>{trip.title}</h2>
              <p>{t[trip.role]}</p>
              <button type="button" onClick={() => void perform(undefined, trip.id)}>
                {t.refresh}
              </button>
              <ul className="groupTripOptions">
                {trip.options.map((option) => (
                  <li key={option.editionId}>
                    <h3>
                      {option.name} {option.year}
                    </h3>
                    {trip.role !== "VIEWER" && (
                      <label>
                        {t.votes}
                        <select
                          aria-label={`${t.votes}: ${option.name} ${option.year}`}
                          value={option.ownVote ?? ""}
                          onChange={({ target }) =>
                            void perform(
                              {
                                kind: "vote",
                                tripId: trip.id,
                                editionId: option.editionId,
                                choice: target.value || null,
                              },
                              trip.id,
                            )
                          }
                        >
                          <option value="">{t.none}</option>
                          {choices.map((choice) => (
                            <option key={choice} value={choice}>
                              {t[choice]}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <p>
                      {choices
                        .map((choice) => `${t[choice]}: ${option.tally[choice] ?? 0}`)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
              {trip.role === "OWNER" ? (
                <>
                  <h3>{t.invitations}</h3>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(
                        {
                          kind: "invite",
                          tripId: trip.id,
                          role: new FormData(event.currentTarget).get("role"),
                        },
                        trip.id,
                      );
                    }}
                  >
                    <label>
                      {t.role}
                      <select name="role" aria-label={t.role}>
                        <option value="VOTER">{t.VOTER}</option>
                        <option value="VIEWER">{t.VIEWER}</option>
                      </select>
                    </label>
                    <button type="submit">{t.invite}</button>
                  </form>
                  {secret && (
                    <label>
                      {t.secret}
                      <input
                        aria-label={t.code}
                        value={secret}
                        readOnly
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </label>
                  )}
                  <ul>
                    {trip.invites?.map((invite) => (
                      <li key={invite.id}>
                        {t[invite.role]} ·{" "}
                        {invite.claimedAt ? t.joined : `${t.expiry}: ${date(invite.expiresAt)}`}{" "}
                        <button
                          type="button"
                          onClick={() =>
                            void perform(
                              { kind: "revoke", tripId: trip.id, inviteId: invite.id },
                              trip.id,
                            )
                          }
                        >
                          {t.revoke}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <details>
                    <summary>{t.audit}</summary>
                    <ul>
                      {trip.audit?.map((event, i) => (
                        <li key={i}>
                          {date(event.createdAt)} · {t[event.action]}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t.removePrompt))
                        void perform({ kind: "delete", tripId: trip.id }, undefined, true);
                    }}
                  >
                    {t.remove}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void perform({ kind: "leave", tripId: trip.id }, undefined, true)}
                >
                  {t.leave}
                </button>
              )}
            </section>
          )}
          <form onSubmit={join}>
            <label>
              {t.code}
              <input name="code" maxLength={43} required autoComplete="off" />
            </label>
            <button type="submit">{t.join}</button>
          </form>
          <form onSubmit={create}>
            <label>
              {t.name}
              <input name="title" maxLength={80} required />
            </label>
            <label>
              {t.editions}
              <select
                name="edition"
                aria-label={t.editions}
                size={Math.min(6, index.editions.length || 1)}
                multiple
                required
              >
                {index.editions.map(({ id, name, year }) => (
                  <option key={id} value={id}>
                    {name} {year}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{t.create}</button>
          </form>
        </fieldset>
      )}
    </div>
  );
}
