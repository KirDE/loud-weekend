"use client";

import Link from "./CatalogLink";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MapLibreMap } from "maplibre-gl";
import Supercluster from "supercluster";
import type { Festival } from "@/lib/domain/festival";
import { festivalMapPoint } from "@/lib/festival-map";
import { useLanguage } from "./LanguageProvider";

const festivalMapLabels = {
  en: {
    show: "Show festival map",
    loading: "Loading map…",
    unavailable: "Map unavailable. Use the festival list below.",
    empty: "No coordinates for these festivals.",
    approximate: "Approximate location",
    verified: "Organizer-confirmed venue",
    source: "Organizer source",
    unknown: "Location not mapped",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    reset: "Fit festival locations",
    close: "Close map results",
    cluster: (count: number) => `${count} festival locations`,
    list: "Festivals by country (list)",
    mapLabel: "Map of Europe with festival locations",
    attribution: "Map data: Natural Earth",
  },
  de: {
    show: "Festivalkarte anzeigen",
    loading: "Karte wird geladen…",
    unavailable: "Karte nicht verfügbar. Nutze die Festivalliste unten.",
    empty: "Für diese Festivals fehlen Koordinaten.",
    approximate: "Ungefährer Standort",
    verified: "Vom Veranstalter bestätigter Ort",
    source: "Quelle des Veranstalters",
    unknown: "Kein Standort auf der Karte",
    zoomIn: "Vergrößern",
    zoomOut: "Verkleinern",
    reset: "Festivalstandorte einpassen",
    close: "Kartenergebnisse schließen",
    cluster: (count: number) => `${count} Festivalstandorte`,
    list: "Festivals nach Land (Liste)",
    mapLabel: "Europakarte mit Festivalstandorten",
    attribution: "Kartendaten: Natural Earth",
  },
  ru: {
    show: "Показать карту фестивалей",
    loading: "Загрузка карты…",
    unavailable: "Карта недоступна. Используйте список фестивалей ниже.",
    empty: "Координаты этих фестивалей неизвестны.",
    approximate: "Приблизительное местоположение",
    verified: "Место подтверждено организатором",
    source: "Источник организатора",
    unknown: "Место не отмечено на карте",
    zoomIn: "Увеличить масштаб",
    zoomOut: "Уменьшить масштаб",
    reset: "Показать все места фестивалей",
    close: "Закрыть результаты на карте",
    cluster: (count: number) => `Мест фестивалей: ${count}`,
    list: "Фестивали по странам (список)",
    mapLabel: "Карта Европы с местами проведения фестивалей",
    attribution: "Данные карты: Natural Earth",
  },
};

type MapLabels = typeof festivalMapLabels.en;
type Marker = { id: string; x: number; y: number } & (
  { slug: string } | { clusterId: number; count: number }
);
const radius = 34;
const maxZoom = 10;

function mapFestivalHref({ slug, editionYear }: Festival) {
  return editionYear ? `/festivals/${slug}/${editionYear}/` : `/festivals/${slug}/`;
}

function FestivalMapViewport({ festivals, t }: { festivals: Festival[]; t: MapLabels }) {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const reset = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [map, setMap] = useState<MapLibreMap>();
  const [failed, setFailed] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selection, setSelection] = useState<{
    id: string;
    slugs: string[];
    festivals: Festival[];
  }>();
  const open = selection?.festivals === festivals ? selection : undefined;
  const { points, index, bySlug, bounds } = useMemo(() => {
    const points = festivals.flatMap((festival) => {
      const coordinates = festivalMapPoint(festival)?.coordinates;
      return coordinates
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates },
              properties: { slug: festival.slug },
            },
          ]
        : [];
    });
    const bySlug = new Map(festivals.map((festival) => [festival.slug, festival]));
    const index = new Supercluster<{ slug: string }>({ radius, maxZoom, extent: 512 }).load(points);
    const bounds = points.reduce<[number, number, number, number]>(
      ([west, south, east, north], point) => {
        const [lng, lat] = point.geometry.coordinates;
        return [
          Math.min(west, lng),
          Math.min(south, lat),
          Math.max(east, lng),
          Math.max(north, lat),
        ];
      },
      [180, 90, -180, -90],
    );
    return { points, index, bySlug, bounds };
  }, [festivals]);

  useEffect(() => {
    if (failed) return;
    let instance: MapLibreMap | undefined;
    let cancelled = false;
    const fail = () => {
      if (!cancelled) setFailed(true);
    };
    const timeout = window.setTimeout(fail, 12_000);
    import("./FestivalMapCanvas")
      .then(({ createFestivalMap }) => {
        if (!host.current || cancelled) return;
        instance = createFestivalMap(host.current);
        instance.getCanvas().tabIndex = -1;
        instance.on("error", fail);
        instance.on("webglcontextlost", fail);
        instance.once("load", () => {
          window.clearTimeout(timeout);
          if (!cancelled) setMap(instance);
        });
      })
      .catch(fail);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      instance?.remove();
    };
  }, [failed]);

  useEffect(() => {
    if (!map || failed || !points.length) return;
    const update = () => {
      const view = map.getBounds();
      const { clientWidth, clientHeight } = map.getContainer();
      const features = index.getClusters(
        [view.getWest(), view.getSouth(), view.getEast(), view.getNorth()],
        Math.floor(map.getZoom()),
      );
      setMarkers(
        features.flatMap<Marker>((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          const { x, y } = map.project([lng, lat]);
          if (x < 21 || y < 21 || x > clientWidth - 21 || y > clientHeight - 21) return [];
          if ("cluster_id" in feature.properties) {
            const { cluster_id: clusterId, point_count: count } = feature.properties;
            return [{ id: `cluster-${clusterId}`, x, y, clusterId, count }];
          }
          const slug = feature.properties.slug;
          return [{ id: slug, x, y, slug }];
        }),
      );
    };
    map.on("move", update);
    map.on("resize", update);
    map.fitBounds(bounds, { padding: 48, maxZoom: 7, duration: 0 });
    update();
    return () => {
      map.off("move", update);
      map.off("resize", update);
    };
  }, [map, failed, points, bounds, index]);

  useEffect(() => {
    if (open) panel.current?.querySelector("a")?.focus();
  }, [open]);

  function close() {
    setSelection(undefined);
    (trigger.current?.isConnected ? trigger.current : reset.current)?.focus();
  }

  if (!points.length) return <p role="status">{t.empty}</p>;
  return (
    <div
      role="group"
      aria-label={t.mapLabel}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}
    >
      {failed && <p role="status">{t.unavailable}</p>}
      {!failed && (
        <>
          <div className="festivalLocationViewport">
            <div ref={host} className="festivalLocationCanvas" aria-hidden="true" />
            {!map && (
              <p className="festivalLocationLoading" role="status">
                {t.loading}
              </p>
            )}
            {map &&
              markers.map((marker) => {
                const active = open?.id === marker.id;
                const festival = "slug" in marker ? bySlug.get(marker.slug) : undefined;
                const verified = festival && festivalMapPoint(festival)?.venue;
                const label = festival
                  ? `${festival.name} · ${verified ? t.verified : t.approximate}`
                  : t.cluster("count" in marker ? marker.count : 1);
                return (
                  <button
                    key={marker.id}
                    className="festivalLocationMarker"
                    type="button"
                    style={{ left: marker.x, top: marker.y }}
                    aria-label={label}
                    aria-expanded={active}
                    aria-controls={panelId}
                    onClick={(event) => {
                      if (active) {
                        close();
                        return;
                      }
                      const slugs =
                        "slug" in marker
                          ? [marker.slug]
                          : index
                              .getLeaves(marker.clusterId, marker.count)
                              .map((item) => item.properties.slug);
                      trigger.current = event.currentTarget;
                      setSelection({ id: marker.id, slugs, festivals });
                    }}
                  >
                    {"slug" in marker ? <span aria-hidden="true">●</span> : marker.count}
                  </button>
                );
              })}
          </div>
          {map && (
            <div className="festivalLocationToolbar">
              <button
                type="button"
                aria-label={t.zoomIn}
                onClick={() => map.jumpTo({ zoom: map.getZoom() + 1 })}
              >
                +
              </button>
              <button
                type="button"
                aria-label={t.zoomOut}
                onClick={() => map.jumpTo({ zoom: map.getZoom() - 1 })}
              >
                −
              </button>
              <button
                type="button"
                ref={reset}
                onClick={() => map.fitBounds(bounds, { padding: 48, maxZoom: 7, duration: 0 })}
              >
                {t.reset}
              </button>
              <small>
                <Link href="/map-licenses.txt" prefetch={false} target="_blank" rel="noreferrer">
                  {t.attribution}
                </Link>
              </small>
            </div>
          )}
          <div id={panelId} ref={panel} className="festivalLocationPopup" hidden={!open}>
            {open && (
              <>
                <button type="button" onClick={close}>
                  {t.close}
                </button>
                <ul>
                  {open.slugs.map((slug) => {
                    const festival = bySlug.get(slug);
                    if (!festival) return null;
                    const venue = festivalMapPoint(festival)?.venue;
                    return (
                      <li key={slug}>
                        <Link href={mapFestivalHref(festival)}>{festival.name}</Link> ·{" "}
                        {venue?.name || festival.city || festival.country}
                        {" · "}
                        {venue ? (
                          <>
                            {t.verified} (
                            <a href={venue.source} rel="noreferrer" target="_blank">
                              {t.source}
                            </a>
                            )
                          </>
                        ) : (
                          t.approximate
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function FestivalLocationMap({
  festivals,
  optIn = false,
}: {
  festivals: Festival[];
  optIn?: boolean;
}) {
  const { language, locale } = useLanguage();
  const t = festivalMapLabels[language];
  const [enabled, setEnabled] = useState(!optIn);
  const activationTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (optIn && enabled) activationTarget.current?.focus();
  }, [optIn, enabled]);
  const groups = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    const countries = new Map<string, { name: string; festivals: Festival[] }>();
    for (const festival of festivals) {
      const code = festival.countryCode;
      const name = /^[A-Z]{2}$/.test(code)
        ? (names.of(code) ?? festival.country)
        : festival.country;
      const group = countries.get(code) ?? { name, festivals: [] };
      group.festivals.push(festival);
      countries.set(code, group);
    }
    return [...countries].sort(([, a], [, b]) => a.name.localeCompare(b.name, locale));
  }, [festivals, locale]);

  return (
    <div className="festivalLocationMap">
      {enabled ? (
        <div ref={activationTarget} role="region" aria-label={t.mapLabel} tabIndex={-1}>
          {festivals.some(festivalMapPoint) ? (
            <FestivalMapViewport festivals={festivals} t={t} />
          ) : (
            <p role="status">{t.empty}</p>
          )}
        </div>
      ) : (
        <button type="button" className="outlineButton" onClick={() => setEnabled(true)}>
          {t.show}
        </button>
      )}
      {enabled && groups.length > 0 && (
        <details className="mapTextList">
          <summary>{t.list}</summary>
          <ul>
            {groups.map(([code, group]) => (
              <li key={code}>
                <strong>{group.name}</strong>
                <ul>
                  {group.festivals.map((festival) => {
                    const point = festivalMapPoint(festival);
                    return (
                      <li key={festival.slug}>
                        <Link href={mapFestivalHref(festival)}>
                          {festival.name}
                          {festival.city ? ` · ${festival.city}` : ""}
                        </Link>
                        {" · "}
                        {point?.venue
                          ? `${point.venue.name} · ${t.verified}`
                          : point
                            ? t.approximate
                            : t.unknown}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
