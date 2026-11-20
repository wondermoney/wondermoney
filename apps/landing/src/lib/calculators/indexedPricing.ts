// Prices indexed electricity offers from what the market really did, instead of ERSE's one-price
// estimate: each supplier's published energy formula (data/indexedFormulas.ts) applied to OMIE's
// Portuguese day-ahead prices (data/omiePrices.ts, or the quarter-hour file for a load diagram).
// Pure and synchronous; the page loads the data and passes it in.
//
// The formulas are linear in the market price, so a stretch of time reduces to a few averages per
// month and tariff period (a "market basis"), weighted by the household's consumption: the E-REDES
// BTN C profile for the last 12 months, or the uploaded diagram's own quarter-hours. The result is
// an energy price per period, EUR/kWh before VAT, that the comparison engine bills like any other
// offer's (electricityTariffComparison.ts). What is not in the formula (the power term, discounts,
// services) stays as ERSE's export gives it.
//
// The regulated parts are today's: the network-access tariff (TAR) and every fixed adder are the
// current ones, applied to past market prices. It answers "what would this offer have cost over
// the last year at today's terms", not "what will it cost".

import { ERSE_TARIFFS } from "./data/erseTariffs";
import type { ContractedPowerKva } from "./electricityOfferTypes";
import type { TariffOption } from "./electricityTariffComparison";
import {
  legalTimeOf,
  QUARTER_HOUR_MS,
  triHourlyPeriodAt,
  type HourlyCycle,
  type LoadReading,
  type TriHourlyPeriod,
} from "./electricityPeriods";


// ---------------------------------------------------------------------------------------------
// Market data

/**
 * One tri-hourly period of one month: [consumption weight, OMIE, OMIE x loss factor, loss factor,
 * the period's arithmetic mean of OMIE, its quarter-hours]. The second to fourth are averages
 * weighted by the consumption. Prices in EUR/MWh.
 */
export type OmieBucket = readonly [
  weight: number,
  omie: number,
  omieLoss: number,
  loss: number,
  mean: number,
  quarters: number,
];

/** A month of market data by period, as data/omiePrices.ts stores it. */
export interface OmieMonth {
  /** "YYYY-MM", Lisbon legal time. */
  month: string;
  /** Quarter-hours in the month. */
  quarters: number;
  /** OMIE's arithmetic mean over the month (or over the days covered), EUR/MWh. */
  mean: number;
  daily: readonly [OmieBucket, OmieBucket, OmieBucket];
  weekly: readonly [OmieBucket, OmieBucket, OmieBucket];
}

export type MarketBasisKind = "last12Months" | "diagram";

/** The market prices an indexed offer is priced on. */
export interface MarketBasis {
  kind: MarketBasisKind;
  /** First and last month covered, "YYYY-MM". */
  from: string;
  to: string;
  months: readonly OmieMonth[];
  /** Diagram only: the share of the diagram's kWh that fell on a day with market prices, 0 to 1. */
  coverage?: number;
}

/** The last `count` months of the committed monthly data, weighted by the BTN C profile. */
export function profileBasis(months: readonly OmieMonth[], count = 12): MarketBasis {
  const kept = months.slice(-count);
  if (kept.length === 0) throw new RangeError("No market months");
  return { kind: "last12Months", from: kept[0].month, to: kept.at(-1)!.month, months: kept };
}

/** The quarter-hour file the page fetches for a load diagram (public/data/omie-pt-quarter-hours.json). */
export interface OmieQuarterHours {
  /** UTC ISO instant of the first quarter-hour; the rest follow one quarter-hour apart. */
  start: string;
  /** OMIE Portugal, hundredths of a EUR/MWh. */
  omie: readonly number[];
  /** Loss factor minus 1, hundred-thousandths. */
  loss: readonly number[];
}

const TRI_INDEX: Record<TriHourlyPeriod, 0 | 1 | 2> = { peak: 0, shoulder: 1, valley: 2 };
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The market basis of a load diagram: each reading's kWh weighs its own quarter-hour's price. The
 * arithmetic means cover the calendar days of the diagram. Readings outside the price file are left
 * out of the averages (`coverage` says how much was priced); null when none could be priced.
 */
export function diagramBasis(readings: readonly LoadReading[], data: OmieQuarterHours): MarketBasis | null {
  const first = Date.parse(data.start);
  const count = Math.min(data.omie.length, data.loss.length);
  const indexOf = (instant: number) => {
    const offset = (instant - first) / QUARTER_HOUR_MS;
    return Number.isInteger(offset) && offset >= 0 && offset < count ? offset : -1;
  };

  type Acc = { w: number; p: number; pl: number; l: number; sum: number; n: number };
  const fresh = (): Acc => ({ w: 0, p: 0, pl: 0, l: 0, sum: 0, n: 0 });
  const months = new Map<string, { sum: number; n: number; daily: Acc[]; weekly: Acc[] }>();
  const monthOf = (key: string) => {
    let entry = months.get(key);
    if (!entry) {
      entry = { sum: 0, n: 0, daily: [fresh(), fresh(), fresh()], weekly: [fresh(), fresh(), fresh()] };
      months.set(key, entry);
    }
    return entry;
  };

  let total = 0;
  let priced = 0;
  const days = new Set<string>();
  for (const { start, kwh } of readings) {
    total += kwh;
    const index = indexOf(start);
    if (index === -1) continue;
    priced += kwh;
    const time = legalTimeOf(start);
    const month = `${time.year}-${pad(time.month)}`;
    days.add(`${month}-${pad(time.day)}`);
    const price = data.omie[index] / 100;
    const loss = 1 + data.loss[index] / 1e5;
    const entry = monthOf(month);
    for (const cycle of ["daily", "weekly"] as const) {
      const acc = entry[cycle][TRI_INDEX[triHourlyPeriodAt(start, cycle)]];
      acc.w += kwh;
      acc.p += kwh * price;
      acc.pl += kwh * price * loss;
      acc.l += kwh * loss;
    }
  }
  if (months.size === 0) return null;

  // Arithmetic means over every quarter-hour of the diagram's days, consumed or not.
  for (let index = 0; index < count; index++) {
    const instant = first + index * QUARTER_HOUR_MS;
    const time = legalTimeOf(instant);
    const month = `${time.year}-${pad(time.month)}`;
    if (!days.has(`${month}-${pad(time.day)}`)) continue;
    const price = data.omie[index] / 100;
    const entry = monthOf(month);
    entry.sum += price;
    entry.n += 1;
    for (const cycle of ["daily", "weekly"] as const) {
      const acc = entry[cycle][TRI_INDEX[triHourlyPeriodAt(instant, cycle)]];
      acc.sum += price;
      acc.n += 1;
    }
  }

  const bucket = (acc: Acc): OmieBucket =>
    acc.w > 0
      ? [acc.w, acc.p / acc.w, acc.pl / acc.w, acc.l / acc.w, acc.n > 0 ? acc.sum / acc.n : acc.p / acc.w, acc.n]
      : [0, 0, 0, 1, acc.n > 0 ? acc.sum / acc.n : 0, acc.n];
  const triple = (accs: Acc[]) => [bucket(accs[0]), bucket(accs[1]), bucket(accs[2])] as const;
  const list: OmieMonth[] = [...months.keys()].sort().map((month) => {
    const entry = months.get(month)!;
    return { month, quarters: entry.n, mean: entry.n > 0 ? entry.sum / entry.n : 0, daily: triple(entry.daily), weekly: triple(entry.weekly) };
  });
  return {
    kind: "diagram",
    from: list[0].month,
    to: list.at(-1)!.month,
    months: list,
    coverage: total > 0 ? priced / total : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Formulas

/**
 * Which OMIE price a formula takes for each kWh:
 * - "quarterHour": the price of the quarter-hour it was consumed in (with a profile, the profile's
 *   share of that quarter-hour), so each period's price is a consumption-weighted average;
 * - "periodMean": the arithmetic mean of the billing month's quarter-hours in the same tariff period
 *   (for the simple option, the whole month);
 * - "monthMean": the arithmetic mean of the whole billing month, the same in every period.
 */
export type OmieBasis = "quarterHour" | "periodMean" | "monthMean";

/**
 * The network losses a formula multiplies the market price by:
 * - "profile": each quarter-hour's loss factor (E-REDES and REN loss profiles, data/omiePrices.ts),
 *   only with the "quarterHour" basis;
 * - "fixed": one factor, such as 1.164;
 * - "monthly": one factor per calendar month, January first.
 */
export type LossFactor =
  | { kind: "profile" }
  | { kind: "fixed"; factor: number }
  | { kind: "monthly"; factors: readonly number[] };

/** EUR/kWh per period of each option, for terms a supplier publishes per period. */
export interface PeriodTerms {
  /** Contracted powers this row applies to, inclusive, kVA. */
  fromKva: number;
  toKva: number;
  simple?: number;
  biHourly?: readonly [offValley: number, valley: number];
  triHourly?: readonly [peak: number, shoulder: number, valley: number];
}

export interface FormulaSource {
  /** The document's title, as the supplier names it. */
  document: string;
  url: string;
  /** Where in the document the formula is, such as "p. 2". */
  location: string;
  /** The day it was read, ISO. */
  readOn: string;
  /** The formula as the document writes it. */
  quote: string;
}

/**
 * One indexed offer's energy price, EUR/kWh before VAT, for each kWh:
 *
 *   limits(multiplier x (OMIE / 1000 + beforeLosses) x loss factor + adder) + levies + TAR or periodTerms
 *
 * OMIE in EUR/MWh, taken as `basis` says. `limits` (a floor and a cap) apply to each billing month's
 * price of each period. `tar: "added"` adds the TAR energy price of the period
 * (ERSE_TARIFFS.tarEnergyPerKwh); `tar: "included"` means the supplier's own per-period terms
 * (`periodTerms`) already hold it, and they are added instead.
 */
export interface IndexedFormula {
  /** ERSE supplier code (COM). */
  supplier: string;
  /** The product, as the supplier names it. */
  product: string;
  /** The ERSE offers (COD_Proposta) that carry this formula. */
  offerIds: readonly string[];
  basis: OmieBasis;
  losses: LossFactor;
  multiplier: number;
  /** EUR/kWh added to OMIE before the losses and the multiplier. */
  beforeLosses: number;
  /** EUR/kWh added after them: margin and other adders. */
  adder: number;
  /** Floor and cap of the market part (everything before `levies`), EUR/kWh. */
  limits?: { min: number; max: number };
  /** EUR/kWh added after the limits, such as the social-tariff financing charge. */
  levies: number;
  tar: "added" | "included";
  periodTerms?: readonly PeriodTerms[];
  /** The options the formula covers. */
  options: readonly TariffOption[];
  sources: readonly FormulaSource[];
  /** What the reading leaves open, in a sentence, for the report and the code. */
  caveat?: string;
}

/** The tri-hourly periods each energy price of `option` covers, in the engine's order. */
const GROUPS: Record<TariffOption, readonly (readonly (0 | 1 | 2)[])[]> = {
  simple: [[0, 1, 2]],
  biHourly: [[0, 1], [2]],
  triHourly: [[0], [1], [2]],
};

/** The TAR energy price of each period of `option`, EUR/kWh. */
export function tarEnergyPrices(option: TariffOption, contractedPower: number): number[] | null {
  const { upTo20_7, above20_7 } = ERSE_TARIFFS.tarEnergyPerKwh;
  if (contractedPower > 20.7) return option === "triHourly" ? [above20_7.peak, above20_7.shoulder, above20_7.triValley] : null;
  switch (option) {
    case "simple":
      return [upTo20_7.simple];
    case "biHourly":
      return [upTo20_7.offValley, upTo20_7.valley];
    case "triHourly":
      return [upTo20_7.peak, upTo20_7.shoulder, upTo20_7.triValley];
  }
}

function periodTermPrices(formula: IndexedFormula, option: TariffOption, contractedPower: number): number[] | null {
  const row = formula.periodTerms?.find((terms) => contractedPower >= terms.fromKva && contractedPower <= terms.toKva);
  const value = row?.[option];
  if (value === undefined) return null;
  return typeof value === "number" ? [value] : [...value];
}

function lossFactorOf(losses: LossFactor, month: string): number {
  switch (losses.kind) {
    case "fixed":
      return losses.factor;
    case "monthly":
      return losses.factors[Number(month.slice(5, 7)) - 1];
    case "profile":
      throw new Error("A profile loss factor needs the quarter-hour basis");
  }
}

/**
 * The market part of one group of periods in one month, EUR/kWh: multiplier x (OMIE / 1000 +
 * beforeLosses) x losses + adder, averaged with the consumption weights, within the limits.
 * Returns [value, weight].
 */
function monthTerm(formula: IndexedFormula, month: OmieMonth, buckets: readonly OmieBucket[]): [number, number] {
  const weight = buckets.reduce((sum, b) => sum + b[0], 0);
  if (weight <= 0) return [0, 0];
  const weighted = (index: 1 | 2 | 3) => buckets.reduce((sum, b) => sum + b[0] * b[index], 0) / weight;
  const { multiplier, beforeLosses, losses, basis } = formula;
  let value: number;
  if (basis === "quarterHour" && losses.kind === "profile") {
    value = (weighted(2) / 1000 + beforeLosses * weighted(3)) * multiplier;
  } else {
    const quarters = buckets.reduce((sum, b) => sum + b[5], 0);
    const omie =
      basis === "quarterHour"
        ? weighted(1)
        : basis === "periodMean"
          ? quarters > 0
            ? buckets.reduce((sum, b) => sum + b[4] * b[5], 0) / quarters
            : month.mean
          : month.mean;
    value = (omie / 1000 + beforeLosses) * lossFactorOf(losses, month.month) * multiplier;
  }
  value += formula.adder;
  if (formula.limits) value = Math.min(formula.limits.max, Math.max(formula.limits.min, value));
  return [value, weight];
}

/** A group's market part with every quarter-hour weighing the same: [value x weight, weight]. */
function unweightedTerm(
  formula: IndexedFormula,
  basis: MarketBasis,
  group: readonly (0 | 1 | 2)[],
  cycle: HourlyCycle,
): [number, number] {
  const all = basis.months.flatMap((month) => [...month.daily]).filter((b) => b[0] > 0);
  const loss = all.length > 0 ? all.reduce((sum, b) => sum + b[0] * b[3], 0) / all.reduce((sum, b) => sum + b[0], 0) : 1;
  const flat: IndexedFormula =
    formula.losses.kind === "profile" ? { ...formula, basis: "periodMean", losses: { kind: "fixed", factor: loss } } : { ...formula, basis: "periodMean" };
  let sum = 0;
  let weight = 0;
  for (const month of basis.months) {
    const buckets = group.map((period): OmieBucket => {
      const b = month[cycle][period];
      return [b[5], b[4], b[4], 1, b[4], b[5]];
    });
    const [value, w] = monthTerm(flat, month, buckets);
    sum += value * w;
    weight += w;
  }
  return [sum, weight];
}

/**
 * The energy price of each period of `option` for an offer with `formula`, EUR/kWh before VAT, on
 * the market `basis`, for the visitor's `cycle`; null when the formula does not cover the option
 * or the power, or the basis has no market price in a period.
 */
export function formulaEnergyPrices(
  formula: IndexedFormula,
  basis: MarketBasis,
  contractedPower: ContractedPowerKva | number,
  option: TariffOption,
  cycle: HourlyCycle,
): number[] | null {
  if (!formula.options.includes(option)) return null;
  const fixed = formula.tar === "added" ? tarEnergyPrices(option, contractedPower) : periodTermPrices(formula, option, contractedPower);
  if (!fixed) return null;
  const prices: number[] = [];
  for (const [index, group] of GROUPS[option].entries()) {
    let sum = 0;
    let weight = 0;
    for (const month of basis.months) {
      const buckets = group.map((period) => month[option === "simple" ? "daily" : cycle][period]);
      const [value, w] = monthTerm(formula, month, buckets);
      sum += value * w;
      weight += w;
    }
    if (weight <= 0) {
      // No consumption in these hours (a diagram can have none): the price then bills nothing, so
      // weigh every quarter-hour alike, at the basis's average loss factor.
      [sum, weight] = unweightedTerm(formula, basis, group, option === "simple" ? "daily" : cycle);
      if (weight <= 0) return null;
    }
    prices.push(sum / weight + formula.levies + fixed[index]);
  }
  return prices;
}

/** What the comparison engine needs to price indexed offers from the market. */
export interface IndexedPricing {
  basis: MarketBasis;
  formulas: readonly IndexedFormula[];
}

/** The formula of an offer, by its ERSE id, or undefined. */
export function formulaFor(formulas: readonly IndexedFormula[], offerId: string): IndexedFormula | undefined {
  return formulas.find((formula) => formula.offerIds.includes(offerId));
}
