// Solar self-consumption for the electricity tariff comparator: the household's consumption, hour
// by hour, less what its panels produce in that hour, so the offers can be ranked on what is still
// taken from the grid. Pure apart from loadSolarDistrict, which loads one district's table.
//
// - Production: a typical year of hourly PV output per kWp for the district capital nearest the
//   visitor (data/solarProduction/, from PVGIS; see solarPvgis.ts), scaled by the kWp and by the
//   system losses (PVGIS applies the losses as a factor: output × (100 − loss) / 86 for the
//   tables' 14 %). Panels face south at PVGIS's optimal tilt for the district.
// - Consumption: the E-REDES load diagram when one is uploaded, its quarter-hours added up per
//   hour. Otherwise a year of quarter-hours is rebuilt from the BTN profile (see profileShape),
//   scaled to the entered kWh and to the entered split across the visitor's periods.
// - Each hour: self-consumed = min(consumption, production), net = consumption − self-consumed
//   (never below 0), surplus = production − self-consumed. The net hour is spread back over its
//   quarter-hours in proportion to their consumption, so the tariff periods (some boundaries fall on
//   a quarter-hour) are read as for any diagram.
// - The surplus can be sold at a price the visitor enters; that income is shown on its own and
//   never enters the ranking, which prices only the grid consumption.

import {
  ELECTRICITY_PROFILE_PERIODS,
  ELECTRICITY_PROFILES_SOURCE,
  legalMidnight,
  QUARTER_HOUR_MS,
  quartersInLegalDay,
  summarizeLoadDiagram,
  triHourlyPeriodAt,
  HOURLY_CYCLES,
  PERIOD_SCHEDULES,
  profileClassFor,
  type CycleKwh,
  type HourlyCycle,
  type LoadReading,
  type PeriodBreakdown,
  type PeriodKwh,
  type ProfileClass,
} from "./electricityPeriods";
import { decodeTypicalYear, PVGIS_DEFAULT_LOSS_PERCENT, typicalHourIndex } from "./solarPvgis";
import { SOLAR_DISTRICTS, type SolarDistrict } from "./data/solarProduction/index";
import { DAYS_PER_YEAR } from "./electricityTaxes";
import { runComparator, type ComparatorRequest, type ComparatorView } from "./electricityTariffComparator";
import type { OfferComparison } from "./electricityTariffComparison";

export { SOLAR_DISTRICTS, SOLAR_PRODUCTION_SOURCE, type SolarDistrict } from "./data/solarProduction/index";

const HOUR_MS = 3_600_000;
const QUARTERS_PER_HOUR = 4;

export const SOLAR_LIMITS = {
  /** Largest system, in kWp: above BTN's 41,4 kVA a household needs another connection. */
  maxKwp: 50,
  maxLossPercent: 50,
  /** Highest surplus sale price accepted, euro per kWh. */
  maxSurplusPrice: 1,
} as const;

export const SOLAR_DEFAULTS = {
  district: "lisboa",
  kwp: 2,
  lossPercent: PVGIS_DEFAULT_LOSS_PERCENT,
} as const;

/** The panels: a district's typical year (Wh per kWp per hour), their size and their losses. */
export interface SolarSystem {
  /** 8760 values, 1 January 00:00 UTC first (decodeTypicalYear). */
  typicalYear: ArrayLike<number>;
  kwp: number;
  lossPercent: number;
}

/** kWh over a stretch of time. */
export interface SolarBalance {
  /** What the household uses, panels or grid. */
  consumption: number;
  production: number;
  /** Production used in the same hour. */
  selfConsumed: number;
  /** Production beyond the household's use, injected into the grid. */
  surplus: number;
  /** Consumption still taken from the grid. */
  net: number;
}

export type SolarField = "kwp" | "lossPercent" | "surplusPrice";

/** Fields out of range: kWp above 0, losses from 0 to 50 %, an optional sale price from 0 to 1 euro. */
export function solarErrors(input: { kwp: number; lossPercent: number; surplusPrice: number | null }) {
  const errors: Partial<Record<SolarField, "required" | "outOfRange">> = {};
  const check = (field: SolarField, value: number, min: number, max: number, exclusiveMin = false) => {
    if (!Number.isFinite(value)) errors[field] = "required";
    else if (value < min || (exclusiveMin && value === min) || value > max) errors[field] = "outOfRange";
  };
  check("kwp", input.kwp, 0, SOLAR_LIMITS.maxKwp, true);
  check("lossPercent", input.lossPercent, 0, SOLAR_LIMITS.maxLossPercent);
  if (input.surplusPrice !== null) check("surplusPrice", input.surplusPrice, 0, SOLAR_LIMITS.maxSurplusPrice);
  return errors;
}

/** kWh per unit of the table (Wh per kWp) for a system. */
function productionFactor(system: Omit<SolarSystem, "typicalYear">): number {
  return (system.kwp * (100 - system.lossPercent)) / (100 - PVGIS_DEFAULT_LOSS_PERCENT) / 1000;
}

/** The system's kWh in the hour that holds a UTC instant. */
export function productionKwhAt(system: SolarSystem, instant: number): number {
  return system.typicalYear[typicalHourIndex(instant)] * productionFactor(system);
}

/** The system's kWh in a typical year. */
export function yearlyProductionKwh(system: SolarSystem): number {
  let sum = 0;
  for (let i = 0; i < system.typicalYear.length; i++) sum += system.typicalYear[i];
  return sum * productionFactor(system);
}

// ---------------------------------------------------------------------------------------------
// Netting

/**
 * Consumption less production, hour by hour. Quarter-hours are grouped by UTC hour (legal time is
 * UTC or UTC+1, so a UTC hour is a legal-time hour); an hour with readings for only some of its
 * quarter-hours gets that share of the hour's production. Returns the net quarter-hours, in time
 * order, and the balance over the readings.
 */
export function netWithSolar(readings: readonly LoadReading[], system: SolarSystem): { net: LoadReading[]; balance: SolarBalance } {
  const sorted = [...readings].sort((a, b) => a.start - b.start);
  const net: LoadReading[] = [];
  const balance: SolarBalance = { consumption: 0, production: 0, selfConsumed: 0, surplus: 0, net: 0 };
  const factor = productionFactor(system);
  for (let i = 0; i < sorted.length; ) {
    const hour = sorted[i].start - (((sorted[i].start % HOUR_MS) + HOUR_MS) % HOUR_MS);
    let j = i;
    let load = 0;
    while (j < sorted.length && sorted[j].start < hour + HOUR_MS) load += sorted[j++].kwh;
    const production = system.typicalYear[typicalHourIndex(hour)] * factor * ((j - i) / QUARTERS_PER_HOUR);
    const self = Math.min(load, production);
    const left = Math.max(0, load - self);
    for (let q = i; q < j; q++) net.push({ start: sorted[q].start, kwh: load > 0 ? (sorted[q].kwh * left) / load : 0 });
    balance.consumption += load;
    balance.production += production;
    balance.selfConsumed += self;
    balance.surplus += production - self;
    balance.net += left;
    i = j;
  }
  return { net, balance };
}

// ---------------------------------------------------------------------------------------------
// Consumption rebuilt from the BTN profile

/** The four ways the profile year is cut into periods: each schedule and each cycle. */
const PARTITIONS = PERIOD_SCHEDULES.flatMap((schedule) => HOURLY_CYCLES.map((cycle) => ({ schedule, cycle })));
const PERIOD_INDEX = { peak: 0, shoulder: 1, valley: 2 } as const;
/** Rounds of iterative proportional fitting: the four partitions agree to about 1e-9 by then. */
const FIT_ROUNDS = 60;

interface ProfileYear {
  /** UTC start of every quarter-hour of the profile's year, in time order. */
  starts: Float64Array;
  /** The legal-time month (0 to 11) of each quarter-hour. */
  months: Uint8Array;
  /** Tri-hourly period index of each quarter-hour, per partition (PARTITIONS order). */
  periods: Uint8Array[];
}

let profileYear: ProfileYear | undefined;

function buildProfileYear(): ProfileYear {
  const year = ELECTRICITY_PROFILES_SOURCE.year;
  const starts: number[] = [];
  const months: number[] = [];
  for (let month = 1; month <= 12; month++) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const midnight = legalMidnight(year, month, day);
      for (let q = 0; q < quartersInLegalDay(year, month, day); q++) {
        starts.push(midnight + q * QUARTER_HOUR_MS);
        months.push(month - 1);
      }
    }
  }
  const periods = PARTITIONS.map(({ schedule, cycle }) =>
    Uint8Array.from(starts, (start) => PERIOD_INDEX[triHourlyPeriodAt(start, cycle, schedule)]),
  );
  return { starts: Float64Array.from(starts), months: Uint8Array.from(months), periods };
}

const shapes = new Map<ProfileClass, Float64Array>();

/**
 * A profile's year as one weight per quarter-hour, in thousandths of the year (they sum to 1000).
 * The bundle carries only each month's share in peak, shoulder and valley hours, for both cycles
 * and both period schedules (data/electricityProfiles.ts), not the 35 040 quarter-hours. The
 * quarter-hours are rebuilt as the most even spread that reproduces all four of those splits in
 * every month: iterative proportional fitting, starting from an even month, scaling the
 * quarter-hours of each period of each split in turn to that period's share. Where the four
 * splits cut the day at different times (08:00, 08:30, 09:00, 10:30, 17:30 and so on, weekdays
 * apart from weekends) the shape follows the profile; within a stretch they do not cut, it is flat.
 */
export function profileShape(profile: ProfileClass): Float64Array {
  const cached = shapes.get(profile);
  if (cached) return cached;
  profileYear ??= buildProfileYear();
  const { months, periods } = profileYear;
  const targets = PARTITIONS.map(({ schedule, cycle }) => ELECTRICITY_PROFILE_PERIODS[profile][schedule][cycle]);
  const count = new Float64Array(12);
  for (const month of months) count[month]++;
  const weights = Float64Array.from(months, (month) => {
    const [peak, shoulder, valley] = targets[0][month];
    return (peak + shoulder + valley) / count[month];
  });
  const sums = new Float64Array(36);
  for (let round = 0; round < FIT_ROUNDS; round++) {
    periods.forEach((labels, p) => {
      sums.fill(0);
      for (let q = 0; q < weights.length; q++) sums[months[q] * 3 + labels[q]] += weights[q];
      for (let q = 0; q < weights.length; q++) {
        const cell = months[q] * 3 + labels[q];
        weights[q] = sums[cell] > 0 ? (weights[q] * targets[p][months[q]][labels[q]]) / sums[cell] : 0;
      }
    });
  }
  shapes.set(profile, weights);
  return weights;
}

/**
 * A year of quarter-hours (the profile's own year) for a consumption entered as totals: the
 * profile's shape scaled to the kWh a year, then each period of the visitor's cycle (current
 * schedule) scaled to the entered split. `consumption` covers `consumption.days` days and is read
 * as a stretch of an average year, as the profile split itself is.
 */
export function profileReadings(consumption: PeriodKwh, contractedPower: number, cycle: HourlyCycle): LoadReading[] {
  const perYear = DAYS_PER_YEAR / consumption.days;
  const annual = consumption.simple.energy * perYear;
  const shape = profileShape(profileClassFor(contractedPower, annual));
  profileYear ??= buildProfileYear();
  const { starts, periods } = profileYear;
  const labels = periods[PARTITIONS.findIndex((partition) => partition.schedule === "current" && partition.cycle === cycle)];
  const { peak, shoulder, valley } = consumption[cycle].triHourly;
  const wanted = [peak * perYear, shoulder * perYear, valley * perYear];
  const have = [0, 0, 0];
  for (let q = 0; q < shape.length; q++) have[labels[q]] += (shape[q] * annual) / 1000;
  const scale = have.map((value, p) => (value > 0 ? wanted[p] / value : 0));
  return Array.from(starts, (start, q) => ({ start, kwh: ((shape[q] * annual) / 1000) * scale[labels[q]] }));
}

// ---------------------------------------------------------------------------------------------
// The comparator's consumption with solar

function scaleCycle(cycle: CycleKwh, factor: number): CycleKwh {
  return {
    biHourly: { offValley: cycle.biHourly.offValley * factor, valley: cycle.biHourly.valley * factor },
    triHourly: { peak: cycle.triHourly.peak * factor, shoulder: cycle.triHourly.shoulder * factor, valley: cycle.triHourly.valley * factor },
  };
}

function periodKwhOf(summary: PeriodBreakdown, days: number, factor = 1): PeriodKwh {
  return {
    days,
    simple: { energy: summary.simple.energy * factor },
    daily: scaleCycle(summary.daily, factor),
    weekly: scaleCycle(summary.weekly, factor),
  };
}

/**
 * The kWh of a profile year's quarter-hours (profileReadings, netted: the same quarter-hours in the
 * same order) by period, for both cycles of the current schedule. The same as summarizeLoadDiagram
 * gives, from the periods the profile year already holds, without classifying 35 040 instants again.
 */
export function profileYearByPeriod(readings: readonly LoadReading[]): PeriodBreakdown {
  profileYear ??= buildProfileYear();
  const { starts, periods } = profileYear;
  if (readings.length !== starts.length || readings.some((reading, q) => reading.start !== starts[q])) {
    return summarizeLoadDiagram(readings);
  }
  const byCycle = (cycle: HourlyCycle): CycleKwh => {
    const labels = periods[PARTITIONS.findIndex((partition) => partition.schedule === "current" && partition.cycle === cycle)];
    const tri = [0, 0, 0];
    readings.forEach((reading, q) => (tri[labels[q]] += reading.kwh));
    return { biHourly: { offValley: tri[0] + tri[1], valley: tri[2] }, triHourly: { peak: tri[0], shoulder: tri[1], valley: tri[2] } };
  };
  return {
    simple: { energy: readings.reduce((sum, reading) => sum + reading.kwh, 0) },
    daily: byCycle("daily"),
    weekly: byCycle("weekly"),
  };
}

export interface SolarConsumptionInput {
  /** The consumption without solar, as the comparator has it. */
  consumption: PeriodKwh;
  /** The uploaded diagram's quarter-hours, or null to rebuild them from the profile. */
  readings: readonly LoadReading[] | null;
  contractedPower: number;
  cycle: HourlyCycle;
  system: SolarSystem;
}

export interface SolarConsumption {
  /** The grid consumption per period, over the same days as the input: what the offers are ranked on. */
  kwh: PeriodKwh;
  /** Over the same days. */
  balance: SolarBalance;
  /** True when the hours come from the uploaded diagram, false when rebuilt from the profile. */
  fromDiagram: boolean;
  /** The uploaded diagram's quarter-hours netted against the production, or null without a diagram. */
  readings: LoadReading[] | null;
}

export function solarConsumption(input: SolarConsumptionInput): SolarConsumption {
  if (input.readings && input.readings.length > 0) {
    const { net, balance } = netWithSolar(input.readings, input.system);
    return { kwh: periodKwhOf(summarizeLoadDiagram(net), input.consumption.days), balance, fromDiagram: true, readings: net };
  }
  const year = profileReadings(input.consumption, input.contractedPower, input.cycle);
  const { net, balance } = netWithSolar(year, input.system);
  const factor = input.consumption.days / DAYS_PER_YEAR;
  const scaled = Object.fromEntries(Object.entries(balance).map(([key, value]) => [key, value * factor])) as unknown as SolarBalance;
  return { kwh: periodKwhOf(profileYearByPeriod(net), input.consumption.days, factor), balance: scaled, fromDiagram: false, readings: null };
}

/** A balance over `days` days as a year's figures (365 days), as the comparator's yearly totals are. */
export function yearlyBalance(balance: SolarBalance, days: number): SolarBalance {
  const factor = DAYS_PER_YEAR / days;
  return {
    consumption: balance.consumption * factor,
    production: balance.production * factor,
    selfConsumed: balance.selfConsumed * factor,
    surplus: balance.surplus * factor,
    net: balance.net * factor,
  };
}

/** Self-consumed share of production, and the share of consumption the panels cover (0 to 1). */
export function solarShares(balance: SolarBalance) {
  return {
    selfConsumed: balance.production > 0 ? balance.selfConsumed / balance.production : 0,
    coverage: balance.consumption > 0 ? balance.selfConsumed / balance.consumption : 0,
  };
}

export interface SolarBillSaving {
  /** The cheapest offer on the grid consumption (the ranking's first). */
  best: OfferComparison;
  /** That offer's total (the ranking's `sortBy`) without solar and with it, VAT included. */
  withoutSolar: number;
  withSolar: number;
  saving: number;
}

/**
 * What the panels save on the bill of the ranking's best offer: the same offer, priced on the
 * consumption without solar, less its total on the grid consumption. `request` is the one the
 * ranking ran on (its consumption is the grid consumption); `gross` is the consumption without
 * solar. Null when the ranking is empty.
 */
export function solarBillSaving(request: ComparatorRequest, view: ComparatorView, gross: PeriodKwh): SolarBillSaving | null {
  const best = view.results[0];
  if (!best) return null;
  const without = runComparator({ ...request, offers: [best.offer], consumption: gross, myTariff: null, cheapestPerSupplier: false });
  const before = without.ok ? without.view.results.find((result) => result.option === best.option) : undefined;
  if (!before) return null;
  const withoutSolar = before[request.sortBy].total;
  const withSolar = best[request.sortBy].total;
  return { best, withoutSolar, withSolar, saving: Math.round((withoutSolar - withSolar) * 100) / 100 };
}

// ---------------------------------------------------------------------------------------------
// Districts

/** The district capital nearest a point (great-circle distance). */
export function nearestDistrict(lat: number, lon: number, districts: readonly SolarDistrict[] = SOLAR_DISTRICTS): SolarDistrict {
  const rad = Math.PI / 180;
  const distance = (district: SolarDistrict) => {
    const dLat = (district.lat - lat) * rad;
    const dLon = (district.lon - lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(district.lat * rad) * Math.sin(dLon / 2) ** 2;
    return Math.asin(Math.min(1, Math.sqrt(a)));
  };
  return districts.reduce((best, district) => (distance(district) < distance(best) ? district : best));
}

const districtFiles = import.meta.glob<{ days: number[][] }>("./data/solarProduction/*.json", { import: "default" });

/** Loads one district's typical year (Wh per kWp per hour); the page fetches it from its own site. */
export async function loadSolarDistrict(slug: string): Promise<Float64Array> {
  const load = districtFiles[`./data/solarProduction/${slug}.json`];
  if (!SOLAR_DISTRICTS.some((district) => district.slug === slug) || !load) throw new Error(`No solar data for ${slug}`);
  return decodeTypicalYear((await load()).days);
}
