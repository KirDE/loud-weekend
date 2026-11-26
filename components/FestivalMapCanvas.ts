import { Map, setWorkerUrl } from "maplibre-gl";
import countries from "world-atlas/countries-110m.json";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import "maplibre-gl/dist/maplibre-gl.css";

const atlas = countries as unknown as Topology<{ countries: GeometryCollection }>;
const boundaries = feature(atlas, atlas.objects.countries);

export function createFestivalMap(container: HTMLElement) {
  // Emit a same-origin worker asset with the app, including when served under a base path.
  setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  return new Map({
    container,
    center: [12, 51],
    zoom: 3,
    minZoom: 1,
    maxZoom: 10,
    renderWorldCopies: false,
    scrollZoom: false,
    dragRotate: false,
    touchPitch: false,
    touchZoomRotate: false,
    keyboard: false,
    attributionControl: false,
    style: {
      version: 8,
      sources: { world: { type: "geojson", data: boundaries } },
      layers: [
        { id: "water", type: "background", paint: { "background-color": "#ccdee5" } },
        { id: "land", type: "fill", source: "world", paint: { "fill-color": "#e7e9d7" } },
        {
          id: "borders",
          type: "line",
          source: "world",
          paint: { "line-color": "#87978d", "line-width": 1 },
        },
      ],
    },
  });
}
