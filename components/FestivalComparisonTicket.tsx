"use client";
import type { Festival } from "@/lib/domain/festival";
import { ticketPresentation } from "@/lib/tickets";
import { useLanguage } from "./LanguageProvider";

export function FestivalComparisonTicket({ item }: { item: Festival }) {
  const { t } = useLanguage();
  const ticket = ticketPresentation(item);
  return (
    <span data-ticket-status={ticket.status}>
      {ticket.href ? (
        <a href={ticket.href} rel="noreferrer" target="_blank">
          {t(ticket.label)}
        </a>
      ) : (
        t(ticket.label)
      )}
    </span>
  );
}
