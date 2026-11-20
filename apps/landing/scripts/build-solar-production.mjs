#!/usr/bin/env node
// Generator for src/lib/calculators/data/solarProduction/ (index.ts and one <slug>.json per district).
//
// Source: PVGIS 5.3, the European Commission Joint Research Centre's Photovoltaic Geographical
// Information System, through its non-interactive API (free, no key). The page cannot call the API
// itself (it sends no CORS headers), so this script computes, for the 18 district capitals of
// mainland Portugal, a typical year of hourly production of a 1 kWp crystalline-silicon system,
// free-standing, facing south at the optimal tilt, with PVGIS's default 14 % system losses.
// The method is in src/lib/calculators/solarPvgis.ts, which this script imports (Node strips the
// types). The radiation database (PVGIS-SARAH3 for Portugal), the years and the tilt are read from
// the responses and written to the module.
//
// Each district's JSON holds 365 rows, one per day: the first UTC hour with production, then the
// Wh per kWp of each hour up to the last one. The page loads one district's file when the visitor
// turns solar on, and scales it by the kWp and the losses (PVGIS applies the losses as a factor).
//
// Usage, from apps/landing:
//
//   node scripts/build-solar-production.mjs [--cache-dir <dir>] [--offline] [--date YYYY-MM-DD]
//
// --cache-dir keeps each API response in <dir> and reuses it on the next run; --offline reads only
// from that cache. --date is the download date the page shows (defaults to today, UTC). Refresh
// when PVGIS publishes a new version or extends its database (the API path names the version).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PVGIS_API,
  PVGIS_DEFAULT_LOSS_PERCENT,
  PVGIS_VERSION,
  encodeTypicalYear,
  parsePvgisPvcalc,
  parsePvgisSeries,
  parsePvgisTmyMonths,
  typicalYear,
} from "../src/lib/calculators/solarPvgis.ts";

export const USER_AGENT = "WonderMoney-landing-build/1.0 (+https://github.com/wondermoney/wondermoney)";

/** The district capitals, at their city centres (the town hall, to about 1 km). */
export const DISTRICTS = [
  { slug: "aveiro", name: "Aveiro", lat: 40.6405, lon: -8.6538 },
  { slug: "beja", name: "Beja", lat: 38.0151, lon: -7.8632 },
  { slug: "braga", name: "Braga", lat: 41.5454, lon: -8.4265 },
  { slug: "braganca", name: "Bragança", lat: 41.8061, lon: -6.7567 },
  { slug: "castelo-branco", name: "Castelo Branco", lat: 39.8222, lon: -7.4909 },
  { slug: "coimbra", name: "Coimbra", lat: 40.2033, lon: -8.4103 },
  { slug: "evora", name: "Évora", lat: 38.5714, lon: -7.9135 },
  { slug: "faro", name: "Faro", lat: 37.0194, lon: -7.9322 },
  { slug: "guarda", name: "Guarda", lat: 40.5373, lon: -7.2676 },
  { slug: "leiria", name: "Leiria", lat: 39.7436, lon: -8.8071 },
  { slug: "lisboa", name: "Lisboa", lat: 38.7223, lon: -9.1393 },
  { slug: "portalegre", name: "Portalegre", lat: 39.2967, lon: -7.4285 },
  { slug: "porto", name: "Porto", lat: 41.1579, lon: -8.6291 },
  { slug: "santarem", name: "Santarém", lat: 39.2362, lon: -8.6859 },
  { slug: "setubal", name: "Setúbal", lat: 38.5244, lon: -8.8882 },
  { slug: "viana-do-castelo", name: "Viana do Castelo", lat: 41.6932, lon: -8.8329 },
  { slug: "vila-real", name: "Vila Real", lat: 41.3006, lon: -7.7441 },
  { slug: "viseu", name: "Viseu", lat: 40.661, lon: -7.9097 },
];

/** Largest accepted gap between the typical year's total and PVGIS's multi-year average. */
export const MAX_YEARLY_GAP = 0.08;
/** Plausible yearly kWh per kWp in mainland Portugal, south at the optimal tilt, 14 % losses. */
export const YEARLY_RANGE = { min: 1100, max: 1900 };

const DATA_DIR = fileURLToPath(new URL("../src/lib/calculators/data/solarProduction/", import.meta.url));

function fail(message) {
  throw new Error(`build-solar-production: ${message}`);
}

const common = (district) => ({ lat: district.lat.toFixed(4), lon: district.lon.toFixed(4), outputformat: "json" });

export function pvcalcUrl(district) {
  const query = new URLSearchParams({
    ...common(district),
    peakpower: "1",
    loss: String(PVGIS_DEFAULT_LOSS_PERCENT),
    optimalinclination: "1",
    aspect: "0",
  });
  return `${PVGIS_API}/PVcalc?${query}`;
}

export function tmyUrl(district) {
  return `${PVGIS_API}/tmy?${new URLSearchParams(common(district))}`;
}

export function seriesUrl(district, slope, year) {
  const query = new URLSearchParams({
    ...common(district),
    peakpower: "1",
    loss: String(PVGIS_DEFAULT_LOSS_PERCENT),
    angle: String(slope),
    aspect: "0",
    pvcalculation: "1",
    startyear: String(year),
    endyear: String(year),
  });
  return `${PVGIS_API}/seriescalc?${query}`;
}

/**
 * One district's typical year and its checks, from a `get(url)` that returns the parsed JSON of
 * each API call.
 */
export async function buildDistrict(district, get) {
  const optimum = parsePvgisPvcalc(await get(pvcalcUrl(district)));
  if (optimum.azimuth !== 0) fail(`${district.slug}: PVcalc did not face south`);
  const tmy = parsePvgisTmyMonths(await get(tmyUrl(district)));
  const series = new Map();
  for (const year of [...new Set(tmy.months.map((month) => month.year))].sort()) {
    const parsed = parsePvgisSeries(await get(seriesUrl(district, optimum.slope, year)));
    if (parsed.slope !== optimum.slope || parsed.azimuth !== 0 || parsed.peakPowerKw !== 1 || parsed.lossPercent !== PVGIS_DEFAULT_LOSS_PERCENT) {
      fail(`${district.slug} ${year}: the series is for another system`);
    }
    if (parsed.radiationDb !== optimum.radiationDb) fail(`${district.slug} ${year}: radiation database ${parsed.radiationDb}`);
    series.set(year, parsed);
  }
  const year = typicalYear(series, tmy.months);
  const yearlyKwh = year.reduce((sum, value) => sum + value, 0) / 1000;
  if (yearlyKwh < YEARLY_RANGE.min || yearlyKwh > YEARLY_RANGE.max) fail(`${district.slug}: implausible ${yearlyKwh.toFixed(0)} kWh/kWp`);
  const gap = Math.abs(yearlyKwh / optimum.yearlyKwh - 1);
  if (gap > MAX_YEARLY_GAP) fail(`${district.slug}: the typical year is ${(gap * 100).toFixed(1)} % off PVGIS's average`);
  return {
    meta: {
      slug: district.slug,
      name: district.name,
      lat: district.lat,
      lon: district.lon,
      slope: optimum.slope,
      yearlyKwhPerKwp: Math.round(yearlyKwh),
      pvgisAverageKwhPerKwp: Math.round(optimum.yearlyKwh),
      monthsSelected: tmy.months.map((month) => month.year),
    },
    meteo: { radiationDb: optimum.radiationDb, meteoDb: optimum.meteoDb, yearMin: optimum.yearMin, yearMax: optimum.yearMax },
    days: encodeTypicalYear(year),
  };
}

export function renderDistrictJson(days) {
  return `{"days":[\n${days.map((day) => JSON.stringify(day)).join(",\n")}\n]}\n`;
}

export function renderIndex(results, { downloadedOn }) {
  const meteo = results[0].meteo;
  for (const result of results) {
    if (JSON.stringify(result.meteo) !== JSON.stringify(meteo)) fail(`${result.meta.slug}: another database or years`);
  }
  return `// Generated by scripts/build-solar-production.mjs. Do not edit by hand: rerun the script.
//
// A typical year of hourly PV production per kWp for each district capital of mainland Portugal,
// from PVGIS (European Commission, Joint Research Centre). Each district's 365 days are in
// ./<slug>.json, loaded when the visitor turns solar on. The method is in the script header and
// in solarPvgis.ts. The page never calls PVGIS.

export const SOLAR_PRODUCTION_SOURCE = {
  name: "PVGIS ${PVGIS_VERSION}, European Commission, Joint Research Centre",
  url: "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en",
  api: "${PVGIS_API}",
  version: "${PVGIS_VERSION}",
  /** Solar radiation database. */
  radiationDb: "${meteo.radiationDb}",
  /** Temperature and wind. */
  meteoDb: "${meteo.meteoDb}",
  yearMin: ${meteo.yearMin},
  yearMax: ${meteo.yearMax},
  /** The system every table is for: 1 kWp of crystalline silicon, free-standing, facing south at the optimal tilt. */
  system: { peakPowerKw: 1, technology: "c-Si", mounting: "free-standing", azimuth: 0, lossPercent: ${PVGIS_DEFAULT_LOSS_PERCENT} },
  downloadedOn: "${downloadedOn}",
  /** Bump when the shape or the derivation changes. */
  format: 1,
} as const;

export interface SolarDistrict {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  /** PVGIS's optimal tilt at the location, in degrees. */
  slope: number;
  /** The typical year's production per kWp. */
  yearlyKwhPerKwp: number;
  /** PVGIS's average over ${meteo.yearMin}-${meteo.yearMax} (PVcalc), for comparison. */
  pvgisAverageKwhPerKwp: number;
  /** The year each month of the typical year comes from, January first (PVGIS TMY). */
  monthsSelected: readonly number[];
}

export const SOLAR_DISTRICTS: readonly SolarDistrict[] = ${JSON.stringify(results.map((result) => result.meta), null, 2)};
`;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const cacheDir = option("--cache-dir");
  const offline = args.includes("--offline");
  const downloadedOn = option("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(downloadedOn)) fail("--date must be YYYY-MM-DD");
  if (offline && !cacheDir) fail("--offline needs --cache-dir");
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });

  const get = async (url) => {
    const cached = cacheDir && join(cacheDir, `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.json`);
    if (cached && existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
    if (offline) fail(`not in the cache: ${url}`);
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }).catch((error) => {
        if (attempt === 3) throw error;
        return null;
      });
      if (!response) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      if (response.ok) {
        const body = await response.text();
        if (cached) writeFileSync(cached, body);
        return JSON.parse(body);
      }
      if (attempt === 3 || (response.status !== 429 && response.status < 500)) fail(`HTTP ${response.status} for ${url}`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  };

  const results = [];
  for (const district of DISTRICTS) {
    const result = await buildDistrict(district, get);
    results.push(result);
    console.log(`${district.slug}: ${result.meta.slope}°, ${result.meta.yearlyKwhPerKwp} kWh/kWp (PVGIS average ${result.meta.pvgisAverageKwhPerKwp})`);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const result of results) writeFileSync(join(DATA_DIR, `${result.meta.slug}.json`), renderDistrictJson(result.days));
  writeFileSync(join(DATA_DIR, "index.ts"), renderIndex(results, { downloadedOn }));
  console.log(`Wrote ${results.length} districts to ${DATA_DIR}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
