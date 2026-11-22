import type { PublicTicketOffers } from "../lib/domain/ticket-offer-proposal";

const copy = {
  en: { title: "Ticket categories", full_pass: "Four-day pass", day_pass: "One-day pass", sold_out: "Sold out", not_on_sale: "Not on sale yet", unknown: "Availability not confirmed", noPrice: "Price not announced", fees: "Fees: unknown — not a checkout total", sale: "Sale announcement (year/time zone not specified)", source: "Official source", checked: "Checked" },
  de: { title: "Ticketkategorien", full_pass: "Vier-Tages-Pass", day_pass: "Tagesticket", sold_out: "Ausverkauft", not_on_sale: "Noch nicht im Verkauf", unknown: "Verfügbarkeit nicht bestätigt", noPrice: "Preis noch nicht angekündigt", fees: "Gebühren: unbekannt — kein Gesamtpreis", sale: "Verkaufsankündigung (Jahr/Zeitzone nicht angegeben)", source: "Offizielle Quelle", checked: "Geprüft" },
  ru: { title: "Категории билетов", full_pass: "Абонемент на четыре дня", day_pass: "Однодневный билет", sold_out: "Распродано", not_on_sale: "Продажи ещё не открыты", unknown: "Наличие не подтверждено", noPrice: "Цена не объявлена", fees: "Комиссии неизвестны — не итоговая стоимость", sale: "Анонс продажи (год и часовой пояс не указаны)", source: "Официальный источник", checked: "Проверено" },
} as const;

/** Receives only the catalog's approved public projection, never review rows. */
export function FestivalTicketOffers({ value, locale }: { value: PublicTicketOffers; locale: keyof typeof copy }) {
  const t = copy[locale];
  return <section className="ticketOfferSection" aria-label={`${t.title} ${value.editionYear}`}>
    <h2>{t.title} · {value.editionYear}</h2>
    <div className="ticketOfferGrid">{value.offers.map(offer => <article key={offer.key} data-tier-kind={offer.kind}>
      <h3>{t[offer.kind]}</h3>
      <p><strong>{t[offer.status]}</strong></p>
      <p>{offer.price ? new Intl.NumberFormat(locale, { style: "currency", currency: offer.price.currency }).format(offer.price.amountMinor / 100) : t.noPrice}</p>
      {offer.price && <p>{t.fees}</p>}
      {offer.saleDateText && <p>{t.sale}: <span>{offer.saleDateText}</span></p>}
    </article>)}</div>
    <p><a href={value.sourceUrl} target="_blank" rel="noreferrer">{t.source}</a> · {t.checked}: <time dateTime={value.observedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value.observedAt))} UTC</time></p>
  </section>;
}
