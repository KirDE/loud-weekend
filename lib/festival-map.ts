import type { Festival } from "./domain/festival";

export function festivalMapPoint(festival: Festival) {
  const { venue } = festival;
  const point = venue ?? festival.coordinates;
  if (!point) return;
  const { latitude, longitude } = point;
  // The map uses Web Mercator. Do not silently clamp points outside its extent.
  if (
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 85.051129 &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  ) {
    return { coordinates: [longitude, latitude] as [number, number], venue };
  }
}
