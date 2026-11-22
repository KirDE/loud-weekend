"use client";

import { useEffect, useRef, useState } from "react";
import type { LifecycleReview } from "../lib/domain/edition-lifecycle-review";
import { loadLifecycleReview, submitLifecycleReview } from "../lib/edition-lifecycle-review-client";

const copy = {
  en: { title: "Edition review", help: "Review the official edition hiatus announcement. Approval records a reviewed lifecycle decision, not ticket inventory. Approval makes this notice visible in the catalogue.", refresh: "Load latest proposal", pending: "Pending review — not published", approved: "Approved — catalogue notice", rejected: "Rejected", approve: "Approve announcement", reject: "Reject proposal", empty: "No proposal collected", error: "Could not confirm the proposal or decision. Reload before reviewing; do not assume it was saved.", busy: "Loading…", evidence: "Source evidence", hash: "Exact revision", stale: "Observation ineligible or expired; collect a fresh proposal.", source: "Official announcement", observed: "Observed at" },
  de: { title: "Editionsprüfung", help: "Die offizielle Ankündigung der Editionspause prüfen. Die Freigabe bestätigt die geprüfte Edition, keinen Ticketbestand. Die Freigabe zeigt den Hinweis im Katalog.", refresh: "Aktuellen Vorschlag laden", pending: "Prüfung ausstehend — nicht veröffentlicht", approved: "Freigegeben — Kataloghinweis", rejected: "Abgelehnt", approve: "Ankündigung freigeben", reject: "Vorschlag ablehnen", empty: "Kein Vorschlag erfasst", error: "Vorschlag oder Entscheidung nicht bestätigt. Vor der Prüfung neu laden; Speicherung nicht voraussetzen.", busy: "Laden…", evidence: "Quellenbeleg", hash: "Exakte Revision", stale: "Beobachtung nicht prüfbar oder abgelaufen; neuen Vorschlag erfassen.", source: "Offizielle Ankündigung", observed: "Beobachtet am" },
  ru: { title: "Проверка редакции", help: "Проверьте официальное объявление о паузе редакции. Одобрение фиксирует решение о редакции, не наличие билетов. Одобрение отображает объявление в каталоге.", refresh: "Загрузить свежий снимок", pending: "Ожидает проверки — не опубликовано", approved: "Одобрено — объявление в каталоге", rejected: "Отклонено", approve: "Одобрить объявление", reject: "Отклонить снимок", empty: "Снимок ещё не собран", error: "Не удалось подтвердить снимок или решение. Загрузите заново перед проверкой; сохранение не подтверждено.", busy: "Загрузка…", evidence: "Доказательство источника", hash: "Точная ревизия", stale: "Снимок недоступен для решения или устарел; соберите свежий.", source: "Официальное объявление", observed: "Время наблюдения" },
} as const;

/** Existing admin review section; API/session authorization is always authoritative. */
export function LifecycleReviewQueue({ editionId, year, festivalSlug, sourceUrl, locale }: { editionId: string; year: number; festivalSlug: string; sourceUrl: string; locale: keyof typeof copy }) {
  const t = copy[locale];
  const [snapshot, setSnapshot] = useState<LifecycleReview | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "ready" | "error">("idle");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const run = async (decision?: "approve" | "reject") => {
    // Ref prevents two actions in the same render frame, not just disabled UI.
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    setState("busy");
    try {
      if (decision) {
        if (!snapshot || snapshot.reviewState !== "pending" || !snapshot.eligibleForReview) throw new Error("No pending revision");
        await submitLifecycleReview(snapshot, decision, signal);
      }
      const latest = await loadLifecycleReview(editionId, signal);
      if (latest && (latest.proposal.editionYear !== year || latest.proposal.festivalSlug !== festivalSlug || latest.proposal.sourceUrl !== sourceUrl)) throw new Error("Edition mismatch");
      if (!controller.signal.aborted) { setSnapshot(latest); setState("ready"); }
    } catch {
      if (!controller.signal.aborted) { setSnapshot(null); setState("error"); }
    } finally { active.current = null; }
  };
  const age = snapshot ? Date.now() - Date.parse(snapshot.proposal.observedAt) : 0;
  const ineligible = !snapshot?.eligibleForReview || age > 86_400_000 || age < -60_000;
  return <article className="reviewCard ticketOfferReview">
    <h3>{t.title} · {festivalSlug} · {year}</h3><p>{t.help}</p>
    <button type="button" className="secondary" disabled={state === "busy"} onClick={() => run()}>{state === "busy" ? t.busy : t.refresh}</button>
    <div role="status" aria-live="polite">{state === "error" ? t.error : state === "ready" && !snapshot ? t.empty : ""}</div>
    {snapshot && <>
      <p><strong>{t[snapshot.reviewState]}</strong></p>
      <p>{snapshot.proposal.festivalSlug} · {snapshot.proposal.editionYear} · {snapshot.proposal.lifecycle} · {snapshot.proposal.announcedReturnYear}</p>
      <p><a href={snapshot.proposal.sourceUrl} rel="noreferrer" target="_blank">{t.source}</a> · {t.observed}: <time dateTime={snapshot.proposal.observedAt}>{snapshot.proposal.observedAt}</time></p>
      <details><summary>{t.evidence}</summary><blockquote>{snapshot.proposal.excerpt}</blockquote><p>{t.hash}: <code style={{ overflowWrap: "anywhere" }}>{snapshot.contentHash}</code></p></details>
      {snapshot.reviewState === "pending" && ineligible && <p role="alert">{t.stale}</p>}
      {snapshot.reviewState === "pending" && <div className="reviewActions"><button type="button" className="secondary" disabled={state === "busy" || ineligible} onClick={() => run("reject")}>{t.reject}</button><button type="button" disabled={state === "busy" || ineligible} onClick={() => run("approve")}>{t.approve}</button></div>}
    </>}
  </article>;
}
