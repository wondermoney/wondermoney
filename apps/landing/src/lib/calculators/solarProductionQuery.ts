// The contract of the landing site's /api/solar-production route, shared by the route
// (src/pages/api/solar-production.ts, through solarProductionApi.ts) and the page that calls it
// (ElectricitySolarPanel.tsx): the query, its limits and rounding, the area PVGIS is asked about,
// and the response.
//
// GET /api/solar-production?lat=38.70&lon=-9.15&angle=35&aspect=0&loss=14
//
//   lat, lon  degrees, rounded to 0.05° (about 5 km); inside one of SOLAR_COVERAGE's boxes
//   angle     tilt from the horizontal, 0 to 90°, rounded to a whole degree
//   aspect    azimuth, -180 to 180°, 0 south, 90 west, -90 east (PVGIS's convention), rounded to a
//             whole degree; ±180 is sent as -179, as PVGIS itself reads it (checked 2026-11-20)
//   loss      system losses, 0 to 50 %, rounded to a whole percent; optional, PVGIS's 14 by default
//
// The route always answers for 1 kWp: the page scales by the visitor's kWp, as it does the
// committed district tables. Rounding bounds the number of distinct requests PVGIS can receive,
// and the canonical query (solarQueryString) is the CDN's cache key: the page only sends it, and
// the route redirects any other spelling of the same values to it.

import { PVGIS_DEFAULT_LOSS_PERCENT } from "./solarPvgis";

export const SOLAR_PRODUCTION_PATH = "/api/solar-production";

/** The query as PVGIS is asked it, after rounding. */
export interface SolarProductionQuery {
  lat: number;
  lon: number;
  angle: number;
  aspect: number;
  loss: number;
}

export type SolarQueryParameter = keyof SolarProductionQuery;

export const SOLAR_QUERY_LIMITS: Record<Exclude<SolarQueryParameter, "lat" | "lon">, { min: number; max: number }> = {
  angle: { min: 0, max: 90 },
  aspect: { min: -180, max: 180 },
  loss: { min: 0, max: 50 },
};

/** Coordinates are rounded to this many degrees. */
export const SOLAR_COORDINATE_STEP = 0.05;

/**
 * Where the route asks PVGIS: Portugal's mainland and its two archipelagos, as boxes a little wider
 * than the land. PVGIS-SARAH3 (PVGIS 5.3's radiation database) covers all three: its tmy and
 * seriescalc answered for Funchal, Porto Santo, Ponta Delgada, Horta, Flores and Santa Maria on
 * 2026-11-20. A box holds some sea (PVGIS answers "Location over the sea" there, which the route
 * reports as location_unavailable) and, on the mainland, a strip of Spain.
 */
export const SOLAR_COVERAGE = [
  { id: "mainland", latMin: 36.9, latMax: 42.2, lonMin: -9.6, lonMax: -6.1 },
  { id: "madeira", latMin: 32.35, latMax: 33.15, lonMin: -17.35, lonMax: -16.2 },
  { id: "azores", latMin: 36.85, latMax: 39.8, lonMin: -31.35, lonMax: -24.95 },
] as const;

export function inSolarCoverage(lat: number, lon: number): boolean {
  return SOLAR_COVERAGE.some((box) => lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax);
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
/** -0 written as 0. */
const clean = (value: number) => (Object.is(value, -0) ? 0 : value);

/** The values PVGIS is asked for: coordinates to 0.05°, angle and aspect to a degree, loss to 1 %. */
export function roundSolarQuery(query: SolarProductionQuery): SolarProductionQuery {
  const aspect = clean(Math.round(query.aspect));
  return {
    lat: clean(Number(roundTo(query.lat, SOLAR_COORDINATE_STEP).toFixed(2))),
    lon: clean(Number(roundTo(query.lon, SOLAR_COORDINATE_STEP).toFixed(2))),
    angle: clean(Math.round(query.angle)),
    aspect: Math.abs(aspect) === 180 ? -179 : aspect,
    loss: clean(Math.round(query.loss)),
  };
}

/** The canonical query string of a query, rounded: the only one the route answers without a redirect. */
export function solarQueryString(query: SolarProductionQuery): string {
  const rounded = roundSolarQuery(query);
  return new URLSearchParams({
    lat: rounded.lat.toFixed(2),
    lon: rounded.lon.toFixed(2),
    angle: String(rounded.angle),
    aspect: String(rounded.aspect),
    loss: String(rounded.loss),
  }).toString();
}

export type SolarQueryError =
  | { error: "missing_parameter"; parameter: SolarQueryParameter }
  | { error: "not_a_number"; parameter: SolarQueryParameter }
  | { error: "out_of_range"; parameter: SolarQueryParameter }
  | { error: "outside_coverage" };

const DECIMAL = /^-?\d{1,3}(\.\d{1,12})?$/;

/** Reads and checks a query string; the query is returned rounded. */
export function parseSolarQuery(params: URLSearchParams): { ok: true; query: SolarProductionQuery } | { ok: false; error: SolarQueryError } {
  const read = (parameter: SolarQueryParameter, fallback?: number): number | SolarQueryError => {
    const raw = params.get(parameter);
    if (raw === null || raw === "") return fallback ?? { error: "missing_parameter", parameter };
    if (!DECIMAL.test(raw)) return { error: "not_a_number", parameter };
    return Number(raw);
  };
  const values = {
    lat: read("lat"),
    lon: read("lon"),
    angle: read("angle"),
    aspect: read("aspect"),
    loss: read("loss", PVGIS_DEFAULT_LOSS_PERCENT),
  };
  for (const value of Object.values(values)) if (typeof value !== "number") return { ok: false, error: value };
  const query = values as SolarProductionQuery;
  if (query.lat < -90 || query.lat > 90) return { ok: false, error: { error: "out_of_range", parameter: "lat" } };
  if (query.lon < -180 || query.lon > 180) return { ok: false, error: { error: "out_of_range", parameter: "lon" } };
  for (const [parameter, { min, max }] of Object.entries(SOLAR_QUERY_LIMITS) as [SolarQueryParameter, { min: number; max: number }][]) {
    if (query[parameter] < min || query[parameter] > max) return { ok: false, error: { error: "out_of_range", parameter } };
  }
  if (!inSolarCoverage(query.lat, query.lon)) return { ok: false, error: { error: "outside_coverage" } };
  return { ok: true, query: roundSolarQuery(query) };
}

/** The route's answer: the committed district tables' shape (`days`), the source and the query used. */
export interface SolarProductionResponse {
  /** One row per day of the typical year, as in data/solarProduction/<slug>.json (encodeTypicalYear). */
  days: number[][];
  /** The typical year's production per kWp. */
  yearlyKwhPerKwp: number;
  /** The year each month of the typical year comes from, January first (PVGIS TMY). */
  monthsSelected: number[];
  source: {
    name: string;
    url: string;
    version: string;
    radiationDb: string;
    meteoDb: string;
    yearMin: number;
    yearMax: number;
  };
  /** What PVGIS was asked: the rounded query, for 1 kWp. */
  params: SolarProductionQuery & { peakpower: 1 };
}

export type SolarProductionErrorCode = SolarQueryError["error"] | "method_not_allowed" | "location_unavailable" | "upstream_error" | "upstream_timeout";
