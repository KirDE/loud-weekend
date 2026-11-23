"use client";
import { useId, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { useLocalPlanner, type PlannerState } from "./LocalPlanner";

const labels = {
  en: {
    clear: "Clear local data",
    title: "Reset this browser's plan?",
    scope:
      "This removes local favorite festivals and artists, attendanc" +
      "e, saved filters and playlist selections. It does not delete" +
      " your account, account data, Spotify playlists or data on ot" +
      "her devices. Nothing is automatically synced to your account" +
      ".",
    backup: "Download plan backup (.json)",
    cancel: "Cancel",
    confirm: "Reset local plan",
    done: "Local plan reset. Your account data has not changed.",
    undo: "Undo local reset",
  },
  de: {
    clear: "Lokale Daten löschen",
    title: "Plan in diesem Browser zurücksetzen?",
    scope:
      "Dies entfernt lokal gespeicherte Festivals und Künstler, Tei" +
      "lnahmen, Filter und Playlist-Auswahl. Dein Konto, Kontodaten" +
      ", Spotify-Playlists und Daten auf anderen Geräten werden nic" +
      "ht gelöscht. Es wird nichts automatisch mit deinem Konto syn" +
      "chronisiert.",
    backup: "Plansicherung herunterladen (.json)",
    cancel: "Abbrechen",
    confirm: "Lokalen Plan zurücksetzen",
    done: "Lokaler Plan zurückgesetzt. Deine Kontodaten bleiben unverändert.",
    undo: "Lokales Zurücksetzen rückgängig machen",
  },
  ru: {
    clear: "Удалить локальные данные",
    title: "Сбросить план в этом браузере?",
    scope:
      "Будут удалены локальные избранные фестивали и артисты, участ" +
      "ие, сохранённые фильтры и выбор фестивалей для плейлиста. Ак" +
      "каунт, данные аккаунта, плейлисты Spotify и данные на других" +
      " устройствах не удаляются. Автоматической синхронизации с ак" +
      "каунтом не будет.",
    backup: "Скачать резервную копию плана (.json)",
    cancel: "Отмена",
    confirm: "Сбросить локальный план",
    done: "Локальный план сброшен. Данные аккаунта не изменились.",
    undo: "Отменить локальный сброс",
  },
};

function snapshot(planner: PlannerState): PlannerState {
  return structuredClone({
    favoriteFestivals: planner.favoriteFestivals,
    favoriteArtists: planner.favoriteArtists,
    attendance: planner.attendance,
    playlistFestivals: planner.playlistFestivals,
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
          href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(snapshot(planner), null, 2))}`}
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
              setBackup(snapshot(planner));
              planner.clear();
            }}
          >
            {t.confirm}
          </button>
        </form>
      </dialog>
      {backup && (
        <div role="status">
          <p>{t.done}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              planner.merge(backup);
              setBackup(null);
            }}
          >
            {t.undo}
          </button>
        </div>
      )}
    </div>
  );
}
