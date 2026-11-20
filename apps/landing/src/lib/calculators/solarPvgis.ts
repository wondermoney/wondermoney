// Reading the EU JRC's PVGIS API and reducing it to a typical year of hourly PV production per kWp.
// Pure and dependency-free, so that scripts/build-solar-production.mjs can import it directly
// (Node strips the types) and the page can decode the committed table with the same code.
//
// PVGIS (Photovoltaic Geographical Information System), European Commission, Joint Research
// Centre, version 5.3: https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en
// API documentation: https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en
//
// Why a committed table and a server route, not a call from the page: the API sends no
// Access-Control-Allow-Origin header and answers OPTIONS with "Method Not Allowed" (checked on
// 2026-11-20), so a browser cannot call it. The committed tables (one per district capital, facing
// south at the optimal tilt) come from scripts/build-solar-production.mjs; any other tilt,
// orientation or location comes through src/pages/api/solar-production.ts. Both use
// fetchPvgisTypicalYear below. The build script calls three endpoints per location:
//   - PVcalc with optimalinclination=1 and aspect=0: the optimal tilt facing south, and PVGIS's own
//     average yearly production over every year of the database, kept as a cross-check.
//   - tmy: the typical meteorological year, of which only `months_selected` is used: for each
//     month, the year PVGIS picked as the most typical one (ISO 15927-4).
//   - seriescalc with pvcalculation=1, for each of those years: the hourly PV power of 1 kWp.
// The typical year is each month taken from its selected year, as PVGIS builds its TMY, so it keeps
// real cloudy and sunny days (an average day would smooth them away and overstate
// self-consumption). Times are UTC; a PVGIS hourly value stamped HH:10 covers the hour from HH:00.

export const PVGIS_API = "https://re.jrc.ec.europa.eu/api/v5_3";
export const PVGIS_VERSION = "5.3";
/** PVGIS's default system losses, in percent. */
export const PVGIS_DEFAULT_LOSS_PERCENT = 14;

/** Hours in the typical year: 365 days, 29 February left out. */
export const TYPICAL_YEAR_HOURS = 8760;
const HOUR_MS = 3_600_000;
const MONTH_START_DAY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A PVGIS response that does not have the shape this module reads. */
export class PvgisResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PvgisResponseError";
  }
}

export interface PvgisMeteo {
  /** Solar radiation database, e.g. "PVGIS-SARAH3". */
  radiationDb: string;
  /** Database of the other variables (temperature, wind), e.g. "ERA5". */
  meteoDb: string;
  yearMin: number;
  yearMax: number;
}

export interface PvgisHour {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** UTC hour the value covers, 0 to 23. */
  hour: number;
  /** Average PV power over the hour, in W: for the hour, Wh. */
  watts: number;
}

export interface PvgisSeries extends PvgisMeteo {
  latitude: number;
  longitude: number;
  /** Tilt from the horizontal, in degrees. */
  slope: number;
  /** 0 is south, 90 west, -90 east. */
  azimuth: number;
  peakPowerKw: number;
  lossPercent: number;
  hours: PvgisHour[];
}

type Json = Record<string, unknown>;

function object(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PvgisResponseError(`No ${what}`);
  return value as Json;
}

function number(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PvgisResponseError(`No number for ${what}`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw new PvgisResponseError(`No text for ${what}`);
  return value;
}

function meteoOf(inputs: Json): PvgisMeteo {
  const meteo = object(inputs.meteo_data, "inputs.meteo_data");
  return {
    radiationDb: text(meteo.radiation_db, "radiation_db"),
    meteoDb: text(meteo.meteo_db, "meteo_db"),
    yearMin: number(meteo.year_min, "year_min"),
    yearMax: number(meteo.year_max, "year_max"),
  };
}

function fixedMounting(inputs: Json) {
  const mounting = object(object(inputs.mounting_system, "inputs.mounting_system").fixed, "a fixed mounting");
  return {
    slope: number(object(mounting.slope, "slope").value, "slope"),
    azimuth: number(object(mounting.azimuth, "azimuth").value, "azimuth"),
  };
}

/** "20230101:0010" to its UTC parts. */
function parseTime(value: unknown): Omit<PvgisHour, "watts"> {
  const match = /^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!match) throw new PvgisResponseError(`Bad time ${String(value)}`);
  const [year, month, day, hour] = match.slice(1, 5).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) throw new PvgisResponseError(`Bad time ${String(value)}`);
  return { year, month, day, hour };
}

/** A seriescalc response (outputformat=json, pvcalculation=1, a fixed mounting). */
export function parsePvgisSeries(json: unknown): PvgisSeries {
  const root = object(json, "response");
  const inputs = object(root.inputs, "inputs");
  const location = object(inputs.location, "inputs.location");
  const module = object(inputs.pv_module, "inputs.pv_module");
  const hourly = object(root.outputs, "outputs").hourly;
  if (!Array.isArray(hourly) || hourly.length === 0) throw new PvgisResponseError("No hourly outputs");
  const hours = hourly.map((row) => {
    const entry = object(row, "hourly row");
    const watts = number(entry.P, "P (PV power): call with pvcalculation=1");
    if (watts < 0) throw new PvgisResponseError(`Negative power at ${String(entry.time)}`);
    return { ...parseTime(entry.time), watts };
  });
  return {
    ...meteoOf(inputs),
    ...fixedMounting(inputs),
    latitude: number(location.latitude, "latitude"),
    longitude: number(location.longitude, "longitude"),
    peakPowerKw: number(module.peak_power, "peak_power"),
    lossPercent: number(module.system_loss, "system_loss"),
    hours,
  };
}

export interface PvgisMonthSelected {
  month: number;
  year: number;
}

/** The year of each month in a tmy response, January first. */
export function parsePvgisTmyMonths(json: unknown): { meteo: PvgisMeteo; months: PvgisMonthSelected[] } {
  const root = object(json, "response");
  const selected = object(root.outputs, "outputs").months_selected;
  if (!Array.isArray(selected)) throw new PvgisResponseError("No months_selected");
  const months = selected
    .map((row) => {
      const entry = object(row, "months_selected row");
      return { month: number(entry.month, "month"), year: number(entry.year, "year") };
    })
    .sort((a, b) => a.month - b.month);
  if (months.length !== 12 || months.some((entry, index) => entry.month !== index + 1)) {
    throw new PvgisResponseError("months_selected does not hold the twelve months");
  }
  return { meteo: meteoOf(object(root.inputs, "inputs")), months };
}

/** A PVcalc response: the mounting PVGIS used (the optimal tilt when asked for) and its yearly kWh. */
export function parsePvgisPvcalc(json: unknown): PvgisMeteo & { slope: number; azimuth: number; yearlyKwh: number } {
  const root = object(json, "response");
  const inputs = object(root.inputs, "inputs");
  const fixed = object(object(object(root.outputs, "outputs").totals, "outputs.totals").fixed, "outputs.totals.fixed");
  return { ...meteoOf(inputs), ...fixedMounting(inputs), yearlyKwh: number(fixed.E_y, "E_y") };
}

/** Index in the typical year of a UTC month, day and hour; 29 February reads as the 28th. */
export function typicalHourIndexOf(month: number, day: number, hour: number): number {
  const dayOfMonth = month === 2 && day === 29 ? 28 : day;
  return (MONTH_START_DAY[month - 1] + dayOfMonth - 1) * 24 + hour;
}

/** Index in the typical year of the hour that holds a UTC instant. */
export function typicalHourIndex(instant: number): number {
  const date = new Date(instant - (instant % HOUR_MS));
  return typicalHourIndexOf(date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours());
}

/**
 * The typical year in Wh per hour (8760 values, 1 January 00:00 UTC first), each month from the
 * series of its selected year. Every series must be for the same system; values are as PVGIS
 * gives them, for the series' peak power.
 */
export function typicalYear(seriesByYear: ReadonlyMap<number, PvgisSeries>, months: readonly PvgisMonthSelected[]): number[] {
  const year = new Array<number>(TYPICAL_YEAR_HOURS).fill(Number.NaN);
  for (const { month, year: selected } of months) {
    const series = seriesByYear.get(selected);
    if (!series) throw new PvgisResponseError(`No series for ${selected}`);
    for (const hour of series.hours) {
      if (hour.year !== selected || hour.month !== month || (month === 2 && hour.day === 29)) continue;
      year[typicalHourIndexOf(hour.month, hour.day, hour.hour)] = hour.watts;
    }
  }
  const missing = year.findIndex((value) => Number.isNaN(value));
  if (missing !== -1) throw new PvgisResponseError(`The typical year has no value for hour ${missing}`);
  return year;
}

/**
 * The compact form of a typical year: one row per day, its first non-zero UTC hour followed by the
 * values from that hour to the last non-zero one, rounded to whole Wh. A day without production is
 * [0].
 */
export function encodeTypicalYear(year: readonly number[]): number[][] {
  if (year.length !== TYPICAL_YEAR_HOURS) throw new RangeError(`A typical year has ${TYPICAL_YEAR_HOURS} hours`);
  const days: number[][] = [];
  for (let d = 0; d < 365; d++) {
    const values = year.slice(d * 24, d * 24 + 24).map((value) => Math.round(value));
    const first = values.findIndex((value) => value > 0);
    if (first === -1) {
      days.push([0]);
      continue;
    }
    const last = values.length - 1 - [...values].reverse().findIndex((value) => value > 0);
    days.push([first, ...values.slice(first, last + 1)]);
  }
  return days;
}

/** The 8760 hourly values of a compact typical year. */
export function decodeTypicalYear(days: readonly (readonly number[])[]): Float64Array {
  if (days.length !== 365) throw new RangeError("A typical year has 365 days");
  const year = new Float64Array(TYPICAL_YEAR_HOURS);
  days.forEach(([first, ...values], d) => {
    if (!Number.isInteger(first) || first < 0 || first + values.length > 24) throw new RangeError(`Bad day ${d}`);
    values.forEach((value, i) => (year[d * 24 + first + i] = value));
  });
  return year;
}

/** Days in each month of the typical year, January first. */
export const TYPICAL_MONTH_DAYS: readonly number[] = MONTH_DAYS;

// ---------------------------------------------------------------------------------------------
// Fetching a typical year: shared by scripts/build-solar-production.mjs (one per district
// capital, at its optimal tilt) and the landing site's /api/solar-production route (any tilt,
// orientation and location).

/** A fixed, free-standing system of 1 kWp of crystalline silicon at a location. */
export interface PvgisSite {
  lat: number;
  lon: number;
  /** Tilt from the horizontal, in degrees. */
  angle: number;
  /** Azimuth: 0 is south, 90 west, -90 east (PVGIS's `aspect`). */
  aspect: number;
  lossPercent: number;
}

/** Returns the parsed JSON of one PVGIS call; throws when the call fails. */
export type PvgisGet = (url: string) => Promise<unknown>;

const coordinates = (site: Pick<PvgisSite, "lat" | "lon">, decimals: number) => ({
  lat: site.lat.toFixed(decimals),
  lon: site.lon.toFixed(decimals),
  outputformat: "json",
});

/** The typical meteorological year at a location; `decimals` is how the coordinates are written. */
export function pvgisTmyUrl(site: Pick<PvgisSite, "lat" | "lon">, decimals = 4): string {
  return `${PVGIS_API}/tmy?${new URLSearchParams(coordinates(site, decimals))}`;
}

/** One calendar year of the system's hourly PV power. */
export function pvgisSeriesUrl(site: PvgisSite, year: number, decimals = 4): string {
  const query = new URLSearchParams({
    ...coordinates(site, decimals),
    peakpower: "1",
    loss: String(site.lossPercent),
    angle: String(site.angle),
    aspect: String(site.aspect),
    pvcalculation: "1",
    startyear: String(year),
    endyear: String(year),
  });
  return `${PVGIS_API}/seriescalc?${query}`;
}

export interface PvgisTypicalYear {
  /** 8760 hourly values in Wh for 1 kWp (typicalYear). */
  year: number[];
  /** The year each month comes from, January first. */
  months: PvgisMonthSelected[];
  /** The TMY's database and the span of years it chose from. */
  meteo: PvgisMeteo;
}

/**
 * A site's typical year: the TMY's selected months (one `tmy` call), then the hourly series of each
 * selected year (one `seriescalc` call per distinct year, up to `concurrency` at a time), each
 * checked to be for the system asked for and from the TMY's radiation database. PVGIS slows every
 * call down when one client sends many at once: on 2026-11-20 nine in parallel took 7 to 8 s each,
 * two at a time about 2 s each (the whole set in 14 s), one at a time about 19 s in all.
 */
export async function fetchPvgisTypicalYear(
  site: PvgisSite,
  get: PvgisGet,
  { decimals = 4, concurrency = 1 }: { decimals?: number; concurrency?: number } = {},
): Promise<PvgisTypicalYear> {
  const tmy = parsePvgisTmyMonths(await get(pvgisTmyUrl(site, decimals)));
  const years = [...new Set(tmy.months.map((month) => month.year))].sort();
  const parsed: PvgisSeries[] = new Array(years.length);
  let next = 0;
  const worker = async () => {
    while (next < years.length) {
      const i = next++;
      parsed[i] = parsePvgisSeries(await get(pvgisSeriesUrl(site, years[i], decimals)));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, years.length)) }, worker));
  const series = new Map<number, PvgisSeries>();
  parsed.forEach((each, i) => {
    if (each.slope !== site.angle || each.azimuth !== site.aspect || each.peakPowerKw !== 1 || each.lossPercent !== site.lossPercent) {
      throw new PvgisResponseError(`The ${years[i]} series is for another system`);
    }
    if (each.radiationDb !== tmy.meteo.radiationDb) throw new PvgisResponseError(`The ${years[i]} series uses radiation database ${each.radiationDb}`);
    series.set(years[i], each);
  });
  return { year: typicalYear(series, tmy.months), months: tmy.months, meteo: tmy.meteo };
}
