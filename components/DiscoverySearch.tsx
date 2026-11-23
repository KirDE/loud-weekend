"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Festival } from "@/lib/domain/festival";
import { discoverySuggestionIndex, discoverySuggestions, type SuggestionArtist } from "@/lib/discovery-suggestions";
import { useLanguage } from "./LanguageProvider";

export function DiscoverySearch({ query, ready, festivals, artists, inputRef, onChange }: {
  query: string;
  ready: boolean;
  festivals: readonly Festival[];
  artists?: readonly SuggestionArtist[];
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (query: string) => void;
}) {
  const { t, locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const index = useMemo(() => discoverySuggestionIndex(festivals, artists ?? []), [festivals, artists]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(query), 160);
    return () => window.clearTimeout(timer);
  }, [query]);

  const canSuggest = settled === query && query.trim().length >= 2 && query.length <= 80;
  const active = open && canSuggest;
  const matches = useMemo(() => discoverySuggestions(active ? settled : "", index, locale), [active, settled, index, locale]);
  const groups = [
    { title: t("artistSuggestions"), items: matches.artists },
    { title: t("festivalSuggestions"), items: matches.festivals },
    { title: t("citySuggestions"), items: matches.cities },
  ];
  const anyMatches = groups.some(group => group.items.length > 0);
  const labels = new Map<string, number>();
  for (const artist of matches.artists) labels.set(artist.label, (labels.get(artist.label) ?? 0) + 1);

  return <div className="search discoverySearch" data-ready={ready}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(false);
      }
      if (event.key === "ArrowDown" && event.target === inputRef.current && canSuggest) {
        if (open && !anyMatches) return;
        event.preventDefault();
        if (open) panel.current?.querySelector<HTMLElement>("a,button")?.focus();
        else {
          focusOnOpen.current = true;
          setOpen(true);
        }
      }
    }}>
    <span aria-hidden="true">⌕</span>
    <input ref={inputRef} aria-label={t("filterSearch")} value={query} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={event => { setOpen(true); onChange(event.target.value); }} placeholder={t("search")} />
    {query && <button type="button" className="clearDiscoverySearch" aria-label={t("clearSearch")}
      onClick={() => { onChange(""); inputRef.current?.focus(); }}><span aria-hidden="true">✕</span></button>}
    {active && <div className="discoverySuggestions" ref={node => {
      panel.current = node;
      if (node && focusOnOpen.current) {
        focusOnOpen.current = false;
        node.querySelector<HTMLElement>("a,button")?.focus();
      }
    }} aria-label={t("searchSuggestions")}>
      {!anyMatches && <p role="status">{t("noSearchSuggestions")}</p>}
      {groups.map(group => group.items.length > 0 && <section key={group.title} aria-label={group.title}>
        <strong>{group.title}</strong>
        <ul>{group.items.map(item => {
          const detail = item.detail ?? ((labels.get(item.label) ?? 0) > 1 ? item.id : undefined);
          const label = detail ? `${item.label} · ${detail}` : item.label;
          return <li key={item.id}>{item.href
            ? <Link href={item.href} prefetch={false} onClick={() => setOpen(false)}>{label}</Link>
            : <button type="button" onClick={() => { onChange(item.value ?? item.label); inputRef.current?.focus(); setOpen(false); }}>{label}</button>}
          </li>;
        })}</ul>
      </section>)}
    </div>}
  </div>;
}
