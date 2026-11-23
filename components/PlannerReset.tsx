"use client";
import { useId, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { useLocalPlanner, type PlannerState } from "./LocalPlanner";
import { browserRunningOrderSnapshot, clearBrowserRunningOrders, restoreBrowserRunningOrders, timetablePlanChanged } from "@/lib/timetable-plan-storage";

const labels = {
  en: { clear: "Clear local data", title: "Reset this browser's plan?", scope: "This removes local favorite festivals and artists, attendance, saved filters, playlist selections and running orders. It does not delete your account, account data, Spotify playlists or data on other devices. Nothing is automatically synced to your account.", backup: "Download plan backup (.json)", cancel: "Cancel", confirm: "Reset local plan", done: "Local plan reset. Your account data has not changed.", undo: "Undo local reset", failed: "Browser storage could not be updated." },
  de: { clear: "Lokale Daten löschen", title: "Plan in diesem Browser zurücksetzen?", scope: "Dies entfernt lokal gespeicherte Festivals und Künstler, Teilnahmen, Filter, Playlist-Auswahl und persönliche Spielpläne. Dein Konto, Kontodaten, Spotify-Playlists und Daten auf anderen Geräten werden nicht gelöscht. Es wird nichts automatisch mit deinem Konto synchronisiert.", backup: "Plansicherung herunterladen (.json)", cancel: "Abbrechen", confirm: "Lokalen Plan zurücksetzen", done: "Lokaler Plan zurückgesetzt. Deine Kontodaten bleiben unverändert.", undo: "Lokales Zurücksetzen rückgängig machen", failed: "Der Browserspeicher konnte nicht aktualisiert werden." },
  ru: { clear: "Удалить локальные данные", title: "Сбросить план в этом браузере?", scope: "Будут удалены локальные избранные фестивали и артисты, участие, сохранённые фильтры, выбор фестивалей для плейлиста и личные расписания. Аккаунт, данные аккаунта, плейлисты Spotify и данные на других устройствах не удаляются. Автоматической синхронизации с аккаунтом не будет.", backup: "Скачать резервную копию плана (.json)", cancel: "Отмена", confirm: "Сбросить локальный план", done: "Локальный план сброшен. Данные аккаунта не изменились.", undo: "Отменить локальный сброс", failed: "Не удалось обновить хранилище браузера." },
};

function snapshot(planner: PlannerState): PlannerState {
  return structuredClone({ favoriteFestivals: planner.favoriteFestivals, favoriteArtists: planner.favoriteArtists,
    attendance: planner.attendance, playlistFestivals: planner.playlistFestivals, savedFilters: planner.savedFilters });
}

type Backup = PlannerState & { runningOrders?: Record<string, string[]> };

export function PlannerReset({ disabled = false, onOpenChange }: { disabled?: boolean; onOpenChange: (open: boolean) => void }) {
  const planner = useLocalPlanner();
  const { language } = useLanguage();
  const t = labels[language];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId(), description = useId();
  const [backup, setBackup] = useState<Backup | null>(null);
  const [runningOrders, setRunningOrders] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState(false);

  function open() {
    setFailed(false);
    try {
      setRunningOrders(browserRunningOrderSnapshot(localStorage));
      onOpenChange(true);
      dialog.current?.showModal();
    } catch {
      setFailed(true);
    }
  }

  function reset() {
    try {
      const current = browserRunningOrderSnapshot(localStorage);
      const previous = { ...snapshot(planner), runningOrders: current };
      planner.clear(() => clearBrowserRunningOrders(localStorage, current));
      setBackup(previous);
      setFailed(false);
      window.dispatchEvent(new Event(timetablePlanChanged));
      return true;
    } catch {
      setFailed(true);
      return false;
    }
  }

  function undo(backup: Backup) {
    try {
      const { runningOrders, ...plan } = backup;
      if (runningOrders) restoreBrowserRunningOrders(localStorage, runningOrders);
      planner.merge(plan);
      window.dispatchEvent(new Event(timetablePlanChanged));
      setBackup(null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  function close() { onOpenChange(false); trigger.current?.focus(); }
  return <div className="plannerReset">
    <button ref={trigger} type="button" className="outlineButton" disabled={!planner.ready || disabled} onClick={open}>{t.clear}</button>
    <dialog ref={dialog} className="plannerResetDialog" aria-labelledby={title} aria-describedby={description} onClose={close}>
      <h2 id={title}>{t.title}</h2>
      <p id={description}>{t.scope}</p>
      <a className="outlineButton" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ ...snapshot(planner), ...(Object.keys(runningOrders).length ? { runningOrders } : {}) }, null, 2))}`} download="loud-weekend-plan-backup.json">{t.backup}</a>
      {failed && <p role="alert">{t.failed}</p>}
      <form method="dialog" className="playlistActions">
        <button autoFocus type="submit" value="cancel">{t.cancel}</button>
        <button type="submit" value="reset" disabled={disabled || !planner.ready} onClick={(event) => {
          if (disabled || !planner.ready) { event.preventDefault(); return; }
          if (!reset()) event.preventDefault();
        }}>{t.confirm}</button>
      </form>
    </dialog>
    {failed && !dialog.current?.open && <p role="alert">{t.failed}</p>}
    {backup && <div role="status"><p>{t.done}</p><button type="button" disabled={disabled} onClick={() => undo(backup)}>{t.undo}</button></div>}
  </div>;
}
