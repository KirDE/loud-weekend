"use client";
import { useId, useRef, useState } from "react";
import { maxTripBudgets } from "@/lib/trip-budget";
import { serializePlannerState } from "@/lib/planner-storage";
import { maxPlaylistArtistPreferences } from "@/lib/playlist-selection";
import { useLanguage } from "./LanguageProvider";
import { useLocalPlanner, type PlannerState } from "./LocalPlanner";

const labels = {
  en: {
    clear: "Clear local data",
    title: "Reset this browser's plan?",
    scope:
      "This removes local favorite festivals and artists, attendance, saved filters, trip " +
      "budgets and playlist selections. It does not delete your account, account data, " +
      "Spotify playlists or data on other devices. Nothing is automatically synced to your " +
      "account.",
    backup: "Download plan backup (.json)",
    cancel: "Cancel",
    confirm: "Reset local plan",
    done: "Local plan reset. Your account data has not changed.",
    undo: "Undo local reset",
    overLimit:
      "Undo would exceed the budget limit. Download the backup or remove a newer estimate, then try again.",
  },
  de: {
    clear: "Lokale Daten löschen",
    title: "Plan in diesem Browser zurücksetzen?",
    scope:
      "Dies entfernt lokal gespeicherte Festivals und Künstler, Teilnahmen, Filter, " +
      "Reisebudgets und Playlist-Auswahl. Dein Konto, Kontodaten, Spotify-Playlists und " +
      "Daten auf anderen Geräten werden nicht gelöscht. Es wird nichts automatisch mit " +
      "deinem Konto synchronisiert.",
    backup: "Plansicherung herunterladen (.json)",
    cancel: "Abbrechen",
    confirm: "Lokalen Plan zurücksetzen",
    done: "Lokaler Plan zurückgesetzt. Deine Kontodaten bleiben unverändert.",
    undo: "Lokales Zurücksetzen rückgängig machen",
    overLimit:
      "Dadurch würde das Budgetlimit überschritten. Lade die Sicherung herunter oder " +
      "entferne eine neuere Schätzung und versuche es erneut.",
  },
  ru: {
    clear: "Удалить локальные данные",
    title: "Сбросить план в этом браузере?",
    scope:
      "Будут удалены локальные избранные фестивали и артисты, участие, сохранённые фильтры, " +
      "бюджеты и выбор фестивалей для плейлиста. Аккаунт, данные аккаунта, плейлисты Spotify " +
      "и данные на других устройствах не удаляются. Автоматической синхронизации с аккаунтом " +
      "не будет.",
    backup: "Скачать резервную копию плана (.json)",
    cancel: "Отмена",
    confirm: "Сбросить локальный план",
    done: "Локальный план сброшен. Данные аккаунта не изменились.",
    undo: "Отменить локальный сброс",
    overLimit:
      "Отмена превысит лимит бюджетов. Скачайте резервную копию или удалите новую оценку и повторите попытку.",
  },
};

function snapshot(planner: PlannerState): PlannerState {
  return structuredClone({
    favoriteFestivals: planner.favoriteFestivals,
    favoriteArtists: planner.favoriteArtists,
    attendance: planner.attendance,
    seasonAttendance: planner.seasonAttendance,
    tripBudgets: planner.tripBudgets,
    playlistFestivals: planner.playlistFestivals,
    playlistExcludedArtists: planner.playlistExcludedArtists,
    savedFilters: planner.savedFilters,
  });
}

export function PlannerReset({
  disabled = false,
  onOpenChange,
}: {
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const planner = useLocalPlanner();
  const { language } = useLanguage();
  const t = labels[language];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId(),
    description = useId();
  const [backup, setBackup] = useState<PlannerState | null>(null);
  const [undoError, setUndoError] = useState(false);
  const backupHref = (state: PlannerState) => {
    const json = JSON.stringify(JSON.parse(serializePlannerState(state)), null, 2);
    return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  };
  function close() {
    onOpenChange(false);
    trigger.current?.focus();
  }
  return (
    <div className="plannerReset">
      <button
        ref={trigger}
        type="button"
        className="outlineButton"
        disabled={!planner.ready || disabled}
        onClick={() => {
          onOpenChange(true);
          dialog.current?.showModal();
        }}
      >
        {t.clear}
      </button>
      <dialog
        ref={dialog}
        className="plannerResetDialog"
        aria-labelledby={title}
        aria-describedby={description}
        onClose={close}
      >
        <h2 id={title}>{t.title}</h2>
        <p id={description}>{t.scope}</p>
        <a
          className="outlineButton"
          href={backupHref(snapshot(planner))}
          download="loud-weekend-plan-backup.json"
        >
          {t.backup}
        </a>
        <form method="dialog" className="playlistActions">
          <button autoFocus type="submit" value="cancel">
            {t.cancel}
          </button>
          <button
            type="submit"
            value="reset"
            disabled={disabled || !planner.ready}
            onClick={(event) => {
              if (disabled || !planner.ready) {
                event.preventDefault();
                return;
              }
              setUndoError(false);
              setBackup(snapshot(planner));
              planner.clear();
            }}
          >
            {t.confirm}
          </button>
        </form>
      </dialog>
      {backup && (
        <div>
          <p role="status">{t.done}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (
                Object.keys({ ...backup.tripBudgets, ...planner.tripBudgets }).length >
                maxTripBudgets
              ) {
                setUndoError(true);
                return;
              }
              const current = planner.playlistExcludedArtists;
              const saved = backup.playlistExcludedArtists;
              const playlistExcludedArtists =
                current && saved
                  ? [...new Set([...current, ...saved])].slice(0, maxPlaylistArtistPreferences)
                  : (current ?? saved);
              planner.merge({ ...backup, playlistExcludedArtists });
              setBackup(null);
              setUndoError(false);
            }}
          >
            {t.undo}
          </button>
          {undoError && (
            <>
              <p role="alert">{t.overLimit}</p>
              <a
                className="outlineButton"
                href={backupHref(backup)}
                download="loud-weekend-plan-backup.json"
              >
                {t.backup}
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
