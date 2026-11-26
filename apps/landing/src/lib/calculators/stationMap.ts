import type { Lang } from "../i18nLocale";
import { formatNumber } from "../numberFormat";
import type { GeoBounds, GeoPoint } from "./fuelStations";

/**
 * The pure parts of the fuel prices page's station map (`components/calculators/StationsMap.tsx`):
 * the initial view and the clusters' cheapest price. No MapLibre here, so they run in plain tests.
 */

/**
 * Mainland Portugal's box, [south, west, north, east]: its extreme points as Wikipedia's "List of
 * extreme points of Portugal" (Continental Portugal) gives them, read on 2026-11-26. South: Cabo de
 * Santa Maria, Faro; west: Cabo da Roca, Sintra; north: Cevide, Melgaço; east: Ifanes e Paradela,
 * Miranda do Douro. Madeira and the Azores are outside it.
 */
export const MAINLAND_PORTUGAL_BOUNDS: GeoBounds = [36.960158, -9.500552, 42.154058, -6.190217];

const inside = ({ lat, lon }: GeoPoint, [south, west, north, east]: GeoBounds) =>
  lat >= south && lat <= north && lon >= west && lon <= east;

/**
 * The box the map opens on: the points that lie inside `limit` (mainland Portugal), so the islands
 * or a point in Spain never widen it; `limit` itself when none does.
 */
export function initialViewBounds(points: readonly GeoPoint[], limit: GeoBounds = MAINLAND_PORTUGAL_BOUNDS): GeoBounds {
  const kept = points.filter((point) => inside(point, limit));
  if (kept.length === 0) return limit;
  const lats = kept.map((point) => point.lat);
  const lons = kept.map((point) => point.lon);
  return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
}

/** Room around the fitted stations, in pixels: more on top, where a pill stands above its point. */
export const FIT_PADDING = { top: 56, bottom: 28, left: 40, right: 56 } as const;
/** The widest the fitted area may be, in map heights. */
const MAX_FIT_ASPECT = 1.6;

/**
 * The fit's padding for a map of this size. On a map much wider than tall, the fitted area is
 * narrowed to MAX_FIT_ASPECT heights by padding both sides alike, so a wide spread of stations
 * is not stretched to the map's edges and stays in the middle. (More on the right, Spain's side,
 * moved Portugal off centre: a national list's box already leans east of the coast.)
 */
export function fitPadding(width: number, height: number): { top: number; bottom: number; left: number; right: number } {
  const extra = width - FIT_PADDING.left - FIT_PADDING.right - MAX_FIT_ASPECT * height;
  if (!(extra > 0) || height <= 0) return { ...FIT_PADDING };
  return { ...FIT_PADDING, left: FIT_PADDING.left + extra / 2, right: FIT_PADDING.right + extra / 2 };
}

/** What each point of the map's GeoJSON source carries: its place in the listed (located) stations and its price. */
export type StationPointProperties = { rank: number; price: number };
export type StationFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: StationPointProperties;
  }>;
};

/**
 * The listed stations with coordinates as GeoJSON points, in list order. The list is for one fuel,
 * so `price` is the selected fuel's price per litre; `rank` indexes the located stations.
 */
export function stationFeatures(stations: ReadonlyArray<{ price: number; lat: number | null; lon: number | null }>): StationFeatureCollection {
  const located = stations.filter((station) => station.lat !== null && station.lon !== null);
  return {
    type: "FeatureCollection",
    features: located.map((station, rank) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [station.lon!, station.lat!] },
      properties: { rank, price: station.price },
    })),
  };
}

/**
 * The GeoJSON source's `clusterProperties`: MapLibre maps each point to its `price` and reduces a
 * cluster's points with `min`, so every cluster carries `cheapest`, its lowest price.
 */
export const CLUSTER_PROPERTIES = { cheapest: ["min", ["get", "price"]] } satisfies Record<string, [string, unknown]>;

/** A cluster feature's cheapest price, or null when it carries none. */
export function clusterCheapest(properties: Record<string, unknown> | null | undefined): number | null {
  const value = properties?.cheapest;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A cluster's label: its cheapest price per litre, the figure alone as on the station pills. */
export function clusterLabel(lang: Lang, cheapest: number): string {
  return formatNumber(lang, cheapest, 3);
}
