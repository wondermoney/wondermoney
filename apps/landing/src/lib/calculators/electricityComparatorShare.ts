// The comparator's share link: the inputs and the list's settings written into the URL's fragment,
// and read back from it. A fragment never reaches the server, and the page drops it from the
// address bar once it is read (and analytics drop it from the URL they record, lib/posthog.ts), so
// a shared bill or consumption is not logged anywhere. Files (the invoice, the E-REDES export),
// the visitor's own prices and the solar panels are not shared: only what is typed or chosen.

import type { ContractedPowerKva } from "./electricityOfferTypes";
import { CONTRACTED_POWER_OPTIONS_KVA, type ComparisonSort, type TariffOption } from "./electricityTariffComparison";
import type { HourlyCycle } from "./electricityPeriods";
import type { OfferFilters, PricingFilter } from "./electricityTariffComparator";

/** The fields of the form a link carries. */
export interface SharedComparison {
  mode: "quick" | "full";
  contractedPower: ContractedPowerKva;
  option: TariffOption;
  cycle: HourlyCycle;
  quickUnit: "bill" | "kwh";
  bill: number;
  monthlyKwh: number;
  /** A link never carries the E-REDES file, so "diagram" is not shared. */
  source: "periods" | "total" | "diagram";
  period: "month" | "year" | "days";
  days: number;
  total: number;
  periods: number[];
  socialTariff: boolean;
  largeFamily: boolean;
  newClient: boolean;
  includeConditioned: boolean;
  includeRefunds: boolean;
  includeDual: boolean;
  cheapestPerSupplier: boolean;
  sortBy: ComparisonSort;
  filters: OfferFilters;
  indexed: "erse" | "market";
}

/** Marks a fragment as a comparator link, so a plain anchor ("#guide") is never read as one. */
const VERSION = "c1";

const FLAGS = ["socialTariff", "largeFamily", "newClient", "includeConditioned", "includeRefunds", "includeDual", "cheapestPerSupplier"] as const;
const FILTER_FLAGS = ["renewableOnly", "noLoyalty", "allowDirectDebit", "allowEInvoice", "allowMandatoryServices"] as const;

/** The fragment ("#v=c1&…") for these settings. */
export function shareFragment(state: SharedComparison): string {
  const params = new URLSearchParams({ v: VERSION, m: state.mode, kva: String(state.contractedPower), o: state.option, c: state.cycle });
  if (state.mode === "quick") {
    params.set("u", state.quickUnit);
    params.set(state.quickUnit === "bill" ? "bill" : "kwh", String(state.quickUnit === "bill" ? state.bill : state.monthlyKwh));
  } else {
    const source = state.source === "diagram" ? "periods" : state.source;
    params.set("s", source);
    params.set("p", state.period);
    if (state.period === "days") params.set("d", String(state.days));
    if (source === "total") params.set("t", String(state.total));
    else params.set("e", state.periods.join("_"));
  }
  for (const flag of FLAGS) params.set(flag, state[flag] ? "1" : "0");
  for (const flag of FILTER_FLAGS) params.set(flag, state.filters[flag] ? "1" : "0");
  params.set("price", state.filters.pricing);
  if (state.filters.supplier) params.set("sup", state.filters.supplier);
  params.set("sort", state.sortBy);
  params.set("idx", state.indexed);
  return `#${params.toString()}`;
}

const oneOf = <T extends string>(value: string | null, choices: readonly T[]): T | undefined =>
  choices.includes(value as T) ? (value as T) : undefined;

/** A finite number from 0 to `max`, or undefined. */
function amount(value: string | null, max: number): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : undefined;
}

/** What a fragment gave: any of the fields, and any of the filters. */
export type SharedSettings = Partial<Omit<SharedComparison, "filters">> & { filters?: Partial<OfferFilters> };

/**
 * The settings in a comparator fragment, or null when the fragment is not one. Each value is
 * checked on its own: one that is missing or out of range is left out, so the form keeps its own.
 */
export function readShareFragment(hash: string): SharedSettings | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("v") !== VERSION) return null;
  const read: SharedSettings = {};
  const set = <K extends keyof SharedSettings>(key: K, value: SharedSettings[K] | undefined) => {
    if (value !== undefined) read[key] = value;
  };

  set("mode", oneOf(params.get("m"), ["quick", "full"] as const));
  const power = Number(params.get("kva"));
  set("contractedPower", CONTRACTED_POWER_OPTIONS_KVA.find((each) => each === power));
  set("option", oneOf(params.get("o"), ["simple", "biHourly", "triHourly"] as const));
  set("cycle", oneOf(params.get("c"), ["daily", "weekly"] as const));
  set("quickUnit", oneOf(params.get("u"), ["bill", "kwh"] as const));
  set("bill", amount(params.get("bill"), 100_000));
  set("monthlyKwh", amount(params.get("kwh"), 1_000_000));
  set("source", oneOf(params.get("s"), ["periods", "total"] as const));
  set("period", oneOf(params.get("p"), ["month", "year", "days"] as const));
  const days = amount(params.get("d"), 731);
  set("days", days !== undefined && Number.isInteger(days) && days >= 1 ? days : undefined);
  set("total", amount(params.get("t"), 10_000_000));
  const periods = params.get("e")?.split("_").map((each) => amount(each, 10_000_000));
  if (periods && periods.length >= 1 && periods.length <= 3 && periods.every((each) => each !== undefined)) {
    read.periods = [...(periods as number[]), ...[0, 0, 0]].slice(0, 3);
  }
  for (const flag of FLAGS) {
    const value = params.get(flag);
    if (value === "1" || value === "0") read[flag] = value === "1";
  }
  set("sortBy", oneOf(params.get("sort"), ["firstYear", "laterYears"] as const));
  set("indexed", oneOf(params.get("idx"), ["erse", "market"] as const));

  const filters: Partial<OfferFilters> = {};
  for (const flag of FILTER_FLAGS) {
    const value = params.get(flag);
    if (value === "1" || value === "0") filters[flag] = value === "1";
  }
  const pricing = oneOf<PricingFilter>(params.get("price"), ["all", "fixed", "indexed"]);
  if (pricing) filters.pricing = pricing;
  const supplier = params.get("sup");
  if (supplier && /^[A-Za-z0-9_-]{1,20}$/.test(supplier)) filters.supplier = supplier;
  if (Object.keys(filters).length > 0) read.filters = filters;
  return read;
}
