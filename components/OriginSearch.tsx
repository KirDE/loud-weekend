"use client";

import { useRef, useState } from "react";
import { readCustomOrigin, type CustomOrigin } from "@/lib/discovery-preferences";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: {
    title: "Find another origin",
    query: "City or postal code",
    search: "Find places",
    empty: "No matches. Try a different spelling or postal code.",
    error: "The place index is unavailable.",
    distance: "Distances are straight-line, not travel distances.",
    searching: "Searching…",
    selected: "Selected origin:",
  },
  de: {
    title: "Anderen Startort finden",
    query: "Ort oder Postleitzahl",
    search: "Orte suchen",
    empty: "Keine Treffer. Prüfe die Schreibweise oder Postleitzahl.",
    error: "Die Ortssuche ist nicht verfügbar.",
    distance: "Entfernungen werden als Luftlinie angegeben.",
    searching: "Suche läuft…",
    selected: "Ausgewählter Startort:",
  },
  ru: {
    title: "Найти другой пункт отправления",
    query: "Город или почтовый индекс",
    search: "Найти места",
    empty: "Ничего не найдено. Проверьте написание или индекс.",
    error: "Поиск мест сейчас недоступен.",
    distance: "Расстояние указывается по прямой, а не по маршруту.",
    searching: "Поиск…",
    selected: "Выбранный пункт отправления:",
  },
};

type Place = CustomOrigin & { id: string; postalCode: string | null; region: string | null };

export function OriginSearch({ onPick }: { onPick: (place: CustomOrigin) => void }) {
  const { language, locale } = useLanguage();
  const copy = labels[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<CustomOrigin | null>(null);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "empty" | "error">("idle");
  const regions = new Intl.DisplayNames([locale], { type: "region" });

  async function search() {
    setSelection(null);
    setStatus("searching");
    setPlaces([]);
    try {
      const response = await fetch("/api/locations/search/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, countryCode: null }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (
        result.available !== true ||
        !Array.isArray(result.places) ||
        !result.places.every(
          (place: Place) => readCustomOrigin(place) && typeof place.id === "string",
        )
      )
        throw new Error();
      setPlaces(result.places);
      setStatus(result.places.length ? "idle" : "empty");
    } catch {
      setStatus("error");
    }
  }

  return (
    <details className="originSearch">
      <summary>{copy.title}</summary>
      <p>
        {copy.distance} <a href="https://www.geonames.org/">GeoNames</a>
      </p>
      <form
        className="lineupSort"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          {copy.query}{" "}
          <input
            ref={inputRef}
            type="search"
            required
            minLength={2}
            maxLength={80}
            value={query}
            disabled={status === "searching"}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" className="outlineButton" disabled={status === "searching"}>
          {copy.search}
        </button>
      </form>
      <div role="status">
        {status !== "idle" && <p>{copy[status]}</p>}
        {selection && (
          <p>
            {copy.selected} {selection.name}, {regions.of(selection.countryCode)}
          </p>
        )}
      </div>
      {places.length > 0 && (
        <ul>
          {places.map(({ id, countryCode, name, latitude, longitude, region, postalCode }) => (
            <li key={id}>
              <button
                type="button"
                className="outlineButton"
                onClick={() => {
                  const origin = { countryCode, name, latitude, longitude };
                  onPick(origin);
                  setSelection(origin);
                  inputRef.current?.focus();
                  setQuery("");
                  setPlaces([]);
                }}
              >
                {[name, postalCode, region, regions.of(countryCode)].filter(Boolean).join(", ")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
