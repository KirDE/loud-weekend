"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Festival } from "@/lib/domain/festival";
import {
  budgetCostFields,
  budgetCountFields,
  budgetCurrencies,
  budgetKey,
  budgetTotal,
  initialBudget,
  parseBudgetCost,
  tripBudgetSchema,
  type TripBudget as Estimate,
} from "@/lib/trip-budget";
import { useLanguage } from "./LanguageProvider";
import { useLocalPlanner } from "./LocalPlanner";

const labels = {
  en: {
    title: "Trip budgets",
    festival: "Festival edition",
    intro:
      "Your estimates, not official prices. Include fees yourself. Amounts are not converted between currencies.",
    local:
      "Saved here by default. Explicit account sync includes budgets; public plan links do not.",
    currency: "Currency",
    people: "People",
    nights: "Nights",
    days: "Days",
    ticket: "Ticket per person",
    travel: "Travel for the group",
    lodging: "Lodging per night",
    camping: "Camping per night",
    food: "Food per person per day",
    save: "Save estimate",
    saved: "Estimate saved.",
    remove: "Remove estimate",
    removed: "Estimate removed.",
    total: "Estimated group total",
    compare: "Compare saved estimates",
    none: "No costs entered",
    missing: "Only entered costs are included in totals.",
    export: "Download estimates (.json)",
    invalid:
      "Use whole numbers for people and nights/days and at most two decimal places for costs. Check the field limits.",
    limit: "Remove a saved estimate before adding another.",
  },
  de: {
    title: "Reisebudgets",
    festival: "Festival-Ausgabe",
    intro:
      "Deine Schätzungen, keine offiziellen Preise. Trage Gebühren selbst ein. Währungen werden nicht umgerechnet.",
    local:
      "Standardmäßig lokal gespeichert. Die manuelle Kontosynchronisierung umfasst Budgets; " +
      "öffentliche Plan-Links nicht.",
    currency: "Währung",
    people: "Personen",
    nights: "Nächte",
    days: "Tage",
    ticket: "Ticket pro Person",
    travel: "Anreise für die Gruppe",
    lodging: "Unterkunft pro Nacht",
    camping: "Camping pro Nacht",
    food: "Verpflegung pro Person und Tag",
    save: "Schätzung speichern",
    saved: "Schätzung gespeichert.",
    remove: "Schätzung entfernen",
    removed: "Schätzung entfernt.",
    total: "Geschätzte Gesamtkosten der Gruppe",
    compare: "Gespeicherte Schätzungen vergleichen",
    none: "Keine Kosten eingetragen",
    missing: "Gesamtsummen enthalten nur eingetragene Kosten.",
    export: "Schätzungen herunterladen (.json)",
    invalid:
      "Gib Personen, Nächte und Tage als ganze Zahlen und Kosten mit höchstens zwei Nachkommastellen ein. " +
      "Beachte die Feldgrenzen.",
    limit: "Entferne eine gespeicherte Schätzung, bevor du eine weitere hinzufügst.",
  },
  ru: {
    title: "Бюджеты поездок",
    festival: "Выпуск фестиваля",
    intro:
      "Это ваши оценки, а не официальные цены. Учитывайте сборы самостоятельно. " +
      "Суммы не пересчитываются между валютами.",
    local:
      "По умолчанию данные хранятся здесь. Ручная синхронизация включает бюджеты; публичные ссылки — нет.",
    currency: "Валюта",
    people: "Человек",
    nights: "Ночей",
    days: "Дней",
    ticket: "Билет на человека",
    travel: "Дорога на группу",
    lodging: "Жильё за ночь",
    camping: "Кемпинг за ночь",
    food: "Питание на человека в день",
    save: "Сохранить оценку",
    saved: "Оценка сохранена.",
    remove: "Удалить оценку",
    removed: "Оценка удалена.",
    total: "Примерная сумма на группу",
    compare: "Сравнить сохранённые оценки",
    none: "Расходы не указаны",
    missing: "Итог учитывает только введённые расходы.",
    export: "Скачать оценки (.json)",
    invalid:
      "Укажите целое число человек, ночей и дней. Для расходов допустимо до двух знаков после разделителя. " +
      "Проверьте пределы полей.",
    limit: "Удалите одну сохранённую оценку, прежде чем добавлять новую.",
  },
} as const;

type Copy = (typeof labels)[keyof typeof labels];
const available = (festival: Festival): festival is Festival & { editionYear: number } =>
  festival.editionYear !== undefined;
const money = (locale: string, plan: Estimate, missing: string) => {
  const cents = budgetTotal(plan);
  return cents === undefined
    ? missing
    : new Intl.NumberFormat(locale, {
        style: "currency",
        currency: plan.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(cents / 100);
};

function BudgetForm({
  stored,
  t,
  locale,
  onSave,
  onRemove,
  status,
  clearStatus,
}: {
  stored: Estimate | undefined;
  t: Copy;
  locale: string;
  onSave: (estimate: Estimate) => boolean;
  status: string;
  clearStatus: () => void;
  onRemove: () => void;
}) {
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(stored);
  const [currency, setCurrency] = useState(stored?.currency ?? initialBudget.currency);
  const notice = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.reset();
    setPreview(stored);
    setCurrency(stored?.currency ?? initialBudget.currency);
  }, [stored]);
  const estimate = stored ?? initialBudget;
  function read(form: HTMLFormElement): Estimate | undefined {
    const data = new FormData(form);
    const values = Object.fromEntries(
      budgetCountFields.map((field) => {
        const value = String(data.get(field));
        return [field, /^\d{1,2}$/.test(value) ? Number(value) : NaN];
      }),
    );
    const costs: Partial<Estimate> = {};
    for (const field of budgetCostFields) {
      const value = String(data.get(field)).trim();
      if (!value) continue;
      const cents = parseBudgetCost(value);
      if (cents === undefined) return undefined;
      costs[field] = cents;
    }
    return tripBudgetSchema.safeParse({ currency: data.get("currency"), ...values, ...costs }).data;
  }
  return (
    <form
      ref={form}
      className="tripBudgetForm"
      onChange={(event) => {
        setError("");
        clearStatus();
        setPreview(read(event.currentTarget));
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const value = read(event.currentTarget);
        if (!value) return setError(t.invalid);
        setError(onSave(value) ? "" : t.limit);
      }}
      aria-describedby={notice}
    >
      <div className="tripBudgetFields">
        <label>
          {t.currency}
          <select
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.currentTarget.value as Estimate["currency"])}
          >
            {budgetCurrencies.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        {budgetCountFields.map((field) => (
          <label key={field}>
            {t[field]}
            <input
              name={field}
              type="number"
              step={1}
              required
              min={field === "people" ? 1 : 0}
              max={field === "people" ? 50 : 60}
              defaultValue={estimate[field]}
            />
          </label>
        ))}
        {budgetCostFields.map((field) => (
          <label key={field}>
            {t[field]}
            <input
              name={field}
              inputMode="decimal"
              maxLength={10}
              defaultValue={estimate[field] === undefined ? "" : (estimate[field] / 100).toFixed(2)}
            />
          </label>
        ))}
      </div>
      <p id={notice}>{t.missing}</p>
      <p>
        {t.total}: <output>{preview ? money(locale, preview, t.none) : "—"}</output>
      </p>
      <div className="playlistActions">
        <button className="primaryButton" type="submit">
          {t.save}
        </button>
        {stored && (
          <button className="outlineButton" type="button" onClick={onRemove}>
            {t.remove}
          </button>
        )}
      </div>
      {error ? <p role="alert">{error}</p> : <p role="status">{status}</p>}
    </form>
  );
}

export function TripBudget({ festivals }: { festivals: Festival[] }) {
  const { language, locale } = useLanguage();
  const t = labels[language],
    planner = useLocalPlanner();
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("");
  const title = useId();
  const options = festivals
    .filter(available)
    .map(
      (festival) =>
        [
          budgetKey(festival.slug, festival.editionYear),
          `${festival.name} ${festival.editionYear}`,
        ] as const,
    );
  const names = new Map<string, string>(options);
  const plans = Object.entries(planner.tripBudgets);
  for (const [key] of plans) if (!names.has(key)) names.set(key, key);
  return (
    <section className="plannerSection" aria-labelledby={title}>
      <h2 id={title}>{t.title}</h2>
      <p>{t.intro}</p>
      <p>{t.local}</p>
      <label className="tripBudgetEdition">
        {t.festival}
        <select
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setStatus("");
          }}
        >
          <option value="">—</option>
          {[...names].map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {selected && names.has(selected) && (
        <BudgetForm
          key={selected}
          stored={planner.tripBudgets[selected]}
          t={t}
          locale={locale}
          status={status}
          clearStatus={() => setStatus("")}
          onSave={(plan) => {
            const saved = planner.setTripBudget(selected, plan);
            setStatus(saved ? t.saved : "");
            return saved;
          }}
          onRemove={() => {
            planner.setTripBudget(selected, undefined);
            if (!options.some(([key]) => key === selected)) setSelected("");
            setStatus(t.removed);
          }}
        />
      )}
      {!selected && status && <p role="status">{status}</p>}
      {plans.length > 0 && (
        <>
          <h3>{t.compare}</h3>
          <ul className="tripBudgetComparison">
            {plans.map(([key, plan]) => (
              <li key={key}>
                <span>{names.get(key) ?? key}</span>
                <strong>{money(locale, plan, t.none)}</strong>
              </li>
            ))}
          </ul>
          <a
            className="outlineButton"
            download="loud-weekend-budget-estimates.json"
            href={
              "data:application/json;charset=utf-8," +
              encodeURIComponent(
                JSON.stringify({ schemaVersion: 1, tripBudgets: planner.tripBudgets }, null, 2),
              )
            }
          >
            {t.export}
          </a>
        </>
      )}
    </section>
  );
}
