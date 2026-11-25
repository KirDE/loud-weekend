"use client";

import { useEffect, useRef, useState } from "react";
import type { TicketOfferReview } from "../lib/domain/ticket-offer-review";
import { loadTicketOfferReview, submitTicketOfferReview } from "../lib/ticket-offer-review-client";
import { FestivalTicketOffers } from "./FestivalTicketOffers";

const copy = {
  en: {
    title: "Hellfest tier review",
    help:
      "Review both categories and their source evidence. " +
      "Approval publishes these categories only, not an overall ticket status.",
    refresh: "Load latest proposal",
    pending: "Pending review — not published",
    approved: "Approved",
    rejected: "Rejected",
    approve: "Approve both categories",
    reject: "Reject proposal",
    empty: "No proposal collected",
    error:
      "Could not confirm the proposal or decision. Reload before reviewing; do not assume it was saved.",
    busy: "Loading…",
    evidence: "Source evidence",
    hash: "Exact revision",
    stale: "Observation expired or future-dated; collect a fresh proposal.",
  },
  de: {
    title: "Hellfest-Ticketprüfung",
    help:
      "Beide Kategorien und Quellenbelege prüfen. " +
      "Die Freigabe veröffentlicht nur diese Kategorien, keinen allgemeinen Ticketstatus.",
    refresh: "Aktuellen Vorschlag laden",
    pending: "Prüfung ausstehend — nicht veröffentlicht",
    approved: "Freigegeben",
    rejected: "Abgelehnt",
    approve: "Beide Kategorien freigeben",
    reject: "Vorschlag ablehnen",
    empty: "Kein Vorschlag erfasst",
    error:
      "Vorschlag oder Entscheidung nicht bestätigt. Vor der Prüfung neu laden; Speicherung nicht voraussetzen.",
    busy: "Laden…",
    evidence: "Quellenbeleg",
    hash: "Exakte Revision",
    stale: "Beobachtung abgelaufen oder in der Zukunft; neuen Vorschlag erfassen.",
  },
  ru: {
    title: "Проверка тарифов Hellfest",
    help:
      "Проверьте обе категории и доказательства источника. " +
      "Одобрение публикует только эти категории, не общий статус билетов.",
    refresh: "Загрузить свежий снимок",
    pending: "Ожидает проверки — не опубликовано",
    approved: "Одобрено",
    rejected: "Отклонено",
    approve: "Одобрить обе категории",
    reject: "Отклонить снимок",
    empty: "Снимок ещё не собран",
    error:
      "Не удалось подтвердить снимок или решение. Загрузите заново перед проверкой; сохранение не подтверждено.",
    busy: "Загрузка…",
    evidence: "Доказательство источника",
    hash: "Точная ревизия",
    stale: "Наблюдение устарело или датировано будущим; соберите свежий снимок.",
  },
} as const;

/** Existing admin review section; API/session authorization is always authoritative. */
export function TicketOfferReviewQueue({
  editionId,
  year,
  locale,
}: {
  editionId: string;
  year: number;
  locale: keyof typeof copy;
}) {
  const t = copy[locale];
  const [snapshot, setSnapshot] = useState<TicketOfferReview | null>(null);
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
        if (!snapshot || snapshot.reviewState !== "pending") throw new Error("No pending revision");
        await submitTicketOfferReview(snapshot, decision, signal);
      }
      const latest = await loadTicketOfferReview(editionId, signal);
      if (latest && latest.proposal.editionYear !== year) throw new Error("Edition mismatch");
      if (!controller.signal.aborted) {
        setSnapshot(latest);
        setState("ready");
      }
    } catch {
      if (!controller.signal.aborted) {
        setSnapshot(null);
        setState("error");
      }
    } finally {
      active.current = null;
    }
  };
  const age = snapshot ? Date.now() - Date.parse(snapshot.proposal.observedAt) : 0;
  const expired = age > 86_400_000 || age < -60_000;
  return (
    <article className="reviewCard ticketOfferReview">
      <h3>
        {t.title} · {year}
      </h3>
      <p>{t.help}</p>
      <button type="button" className="secondary" disabled={state === "busy"} onClick={() => run()}>
        {state === "busy" ? t.busy : t.refresh}
      </button>
      <div role="status" aria-live="polite">
        {state === "error" ? t.error : state === "ready" && !snapshot ? t.empty : ""}
      </div>
      {snapshot && (
        <>
          <p>
            <strong>{t[snapshot.reviewState]}</strong>
          </p>
          <FestivalTicketOffers value={snapshot.proposal} locale={locale} />
          <details>
            <summary>{t.evidence}</summary>
            {snapshot.proposal.offers.map((offer) => (
              <blockquote key={offer.key}>
                {offer.label}: {offer.excerpt}
              </blockquote>
            ))}
            <p>
              {t.hash}: <code style={{ overflowWrap: "anywhere" }}>{snapshot.contentHash}</code>
            </p>
          </details>
          {expired && <p role="alert">{t.stale}</p>}
          {snapshot.reviewState === "pending" && (
            <div className="reviewActions">
              <button
                type="button"
                className="secondary"
                disabled={state === "busy" || expired}
                onClick={() => run("reject")}
              >
                {t.reject}
              </button>
              <button
                type="button"
                disabled={state === "busy" || expired}
                onClick={() => run("approve")}
              >
                {t.approve}
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
