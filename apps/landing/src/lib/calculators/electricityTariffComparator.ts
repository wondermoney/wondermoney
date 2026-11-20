// The page layer of the electricity tariff comparator (/tools electricity tariff comparison): what
// the visitor types turned into the comparison engine's input, the filters the engine leaves to the
// page, the visitor's own tariff priced as a synthetic offer, the best offer of each tariff option
// and the CSV export. Pure: the offers are passed in (the page loads data/electricityOffers.ts with
// a dynamic import, and this module must not import it statically).
//
// - Monthly figures cover 365/12 days, a twelfth of ERSE's year, as ERSE's "1 mês" does.
// - A bill in euro becomes kWh by solving the regulated tariff's (TUR) bill for the kWh, with the
//   same taxes, as ERSE's quick simulation does.
// - A total kWh is split across the periods with the E-REDES BTN profile of the household
//   (electricityPeriods.ts). kWh entered for one option are carried to the others: bi-hourly from
//   tri-hourly by adding peak and shoulder, tri-hourly from bi-hourly with the profile's share of
//   peak within the off-valley hours.

import type { ContractedPowerKva, ElectricityOffer } from "./electricityOfferTypes";
import {
  compareElectricityOffers,
  TARIFF_OPTIONS,
  type ComparisonSort,
  type OfferComparison,
  type TariffComparisonError,
  type TariffComparisonField,
  type TariffOption,
} from "./electricityTariffComparison";
import { profileClassFor, profilePeriodShares, type CycleKwh, type HourlyCycle, type PeriodKwh } from "./electricityPeriods";
import { DAYS_PER_YEAR } from "./electricityTaxes";
import type { IndexedPricing } from "./indexedPricing";
import { supplierName } from "./electricitySuppliers";
import type { Lang } from "../i18nLocale";
import { toIntlLocale } from "../numberFormat";

/** Days in a month: a twelfth of the 365-day year (ERSE's "1 mês"). */
export const MONTH_DAYS = DAYS_PER_YEAR / 12;

/** The number of energy prices (periods) of each option. */
export const OPTION_PERIODS: Record<TariffOption, number> = { simple: 1, biHourly: 2, triHourly: 3 };

export const COMPARATOR_LIMITS = {
  /** Highest monthly bill or kWh the quick mode accepts. */
  maxMonthlyKwh: 20_000,
  maxMonthlyBill: 10_000,
} as const;

// ---------------------------------------------------------------------------------------------
// Consumption

const annualOf = (kwh: number, days: number) => (days > 0 ? (kwh * DAYS_PER_YEAR) / days : 0);

function cycleKwh(peak: number, shoulder: number, valley: number): CycleKwh {
  return { biHourly: { offValley: peak + shoulder, valley }, triHourly: { peak, shoulder, valley } };
}

/** A total over `days` days, split across the periods with the household's BTN profile. */
export function splitTotal(kwh: number, days: number, contractedPower: number): PeriodKwh {
  const shares = profilePeriodShares(profileClassFor(contractedPower, annualOf(kwh, days)));
  const scale = (cycle: CycleKwh) =>
    cycleKwh(cycle.triHourly.peak * kwh, cycle.triHourly.shoulder * kwh, cycle.triHourly.valley * kwh);
  return { days, simple: { energy: kwh }, daily: scale(shares.daily), weekly: scale(shares.weekly) };
}

/**
 * kWh entered per period of `option` (one, two or three values, in the order of the invoice:
 * simple; off-valley and valley; peak, shoulder and valley) for the visitor's `cycle`. The other
 * cycle gets the same values: the engine prices on the visitor's cycle only.
 */
export function periodsFromEntry(
  option: TariffOption,
  values: readonly number[],
  days: number,
  contractedPower: number,
  cycle: HourlyCycle,
): PeriodKwh {
  if (option === "simple") return splitTotal(values[0], days, contractedPower);
  const total = values.reduce((sum, value) => sum + value, 0);
  let entered: CycleKwh;
  if (option === "triHourly") {
    entered = cycleKwh(values[0], values[1], values[2]);
  } else {
    const [offValley, valley] = values;
    const { peak, shoulder } = profilePeriodShares(profileClassFor(contractedPower, annualOf(total, days)))[cycle].triHourly;
    const peakShare = peak + shoulder > 0 ? peak / (peak + shoulder) : 0;
    entered = cycleKwh(offValley * peakShare, offValley * (1 - peakShare), valley);
  }
  return { days, simple: { energy: total }, daily: entered, weekly: entered };
}

// ---------------------------------------------------------------------------------------------
// Quick mode: a bill in euro to kWh

export interface BillToKwhInput {
  /** The monthly bill, VAT included. */
  bill: number;
  contractedPower: ContractedPowerKva;
  option: TariffOption;
  cycle: HourlyCycle;
  socialTariff: boolean;
  largeFamily: boolean;
}

export type BillToKwhOutcome =
  | { ok: true; monthlyKwh: number }
  | { ok: false; error: "noRegulatedPrice" }
  | { ok: false; error: "belowFixed"; minimum: number }
  | { ok: false; error: "tooLarge"; maximum: number };

/** The regulated tariff's month (365/12 days) for `kwh`, VAT included, or null without its price. */
export function regulatedMonthlyBill(regulated: ElectricityOffer, kwh: number, input: Omit<BillToKwhInput, "bill">) {
  const outcome = compareElectricityOffers([regulated], {
    contractedPower: input.contractedPower,
    kwh: splitTotal(kwh, MONTH_DAYS, input.contractedPower),
    cycle: input.cycle,
    options: [input.option],
    socialTariff: input.socialTariff,
    largeFamily: input.largeFamily,
    newClient: false,
    includeRefunds: false,
    includeConditioned: true,
  });
  if (!outcome.ok || outcome.result.results.length === 0) return null;
  return outcome.result.results[0].period.total;
}

/**
 * The monthly kWh whose regulated-tariff bill, taxes included, comes to `bill`: the bill is solved
 * for the kWh by bisection (it only grows with the kWh).
 */
export function monthlyKwhFromBill(regulated: ElectricityOffer, input: BillToKwhInput): BillToKwhOutcome {
  const bill = (kwh: number) => regulatedMonthlyBill(regulated, kwh, input);
  const minimum = bill(0);
  if (minimum === null) return { ok: false, error: "noRegulatedPrice" };
  if (input.bill < minimum) return { ok: false, error: "belowFixed", minimum };
  const maximum = bill(COMPARATOR_LIMITS.maxMonthlyKwh) as number;
  if (input.bill > maximum) return { ok: false, error: "tooLarge", maximum };
  let low = 0;
  let high: number = COMPARATOR_LIMITS.maxMonthlyKwh;
  for (let i = 0; i < 60 && high - low > 0.01; i++) {
    const mid = (low + high) / 2;
    if ((bill(mid) as number) < input.bill) low = mid;
    else high = mid;
  }
  return { ok: true, monthlyKwh: Math.round(((low + high) / 2) * 10) / 10 };
}

// ---------------------------------------------------------------------------------------------
// Filters the engine leaves to the page

export type PricingFilter = "all" | "fixed" | "indexed";

export interface OfferFilters {
  pricing: PricingFilter;
  /** Only offers ERSE marks as 100 % renewable. */
  renewableOnly: boolean;
  /** Only offers without a loyalty period. */
  noLoyalty: boolean;
  /** Keep offers that require direct debit. */
  allowDirectDebit: boolean;
  /** Keep offers that require an electronic invoice. */
  allowEInvoice: boolean;
  /** Keep offers that come with paid mandatory services. */
  allowMandatoryServices: boolean;
  /** One supplier's code, or null for all. */
  supplier: string | null;
}

export const DEFAULT_OFFER_FILTERS: OfferFilters = {
  pricing: "all",
  renewableOnly: false,
  noLoyalty: false,
  allowDirectDebit: true,
  allowEInvoice: true,
  allowMandatoryServices: true,
  supplier: null,
};

export function filterOffers(offers: readonly ElectricityOffer[], filters: OfferFilters): ElectricityOffer[] {
  return offers.filter((offer) => {
    if (filters.pricing === "fixed" && offer.indexed) return false;
    if (filters.pricing === "indexed" && !offer.indexed) return false;
    if (filters.renewableOnly && !offer.renewable) return false;
    if (filters.noLoyalty && offer.loyalty) return false;
    if (!filters.allowDirectDebit && offer.requirements.directDebit) return false;
    if (!filters.allowEInvoice && offer.requirements.eInvoice) return false;
    if (!filters.allowMandatoryServices && offer.mandatoryServicesPerYear > 0) return false;
    if (filters.supplier !== null && offer.supplier !== filters.supplier) return false;
    return true;
  });
}

export interface SupplierChoice {
  code: string;
  name: string;
  regulated: boolean;
}

/** Every supplier in the offers, by name, the regulated tariff first. */
export function supplierChoices(offers: readonly ElectricityOffer[], regulatedName: string): SupplierChoice[] {
  const byCode = new Map<string, SupplierChoice>();
  for (const offer of offers) {
    if (byCode.has(offer.supplier)) continue;
    byCode.set(offer.supplier, {
      code: offer.supplier,
      name: offer.regulated ? regulatedName : supplierName(offer.supplier),
      regulated: offer.regulated,
    });
  }
  return [...byCode.values()].sort(
    (a, b) => Number(b.regulated) - Number(a.regulated) || a.name.localeCompare(b.name, "pt"),
  );
}

// ---------------------------------------------------------------------------------------------
// The visitor's own tariff

export const MY_TARIFF_ID = "MY_TARIFF";

/** Prices from the visitor's invoice, before VAT: power per day and energy per kWh per period. */
export interface MyTariffPrices {
  powerPerDay: number;
  /** One price per period of the option, in the order of `periodsFromEntry`. */
  energy: readonly number[];
}

export type MyTariffField = "powerPerDay" | `energy${number}`;

/** Prices that are missing, negative or implausible (above 5 EUR per day or per kWh). */
export function myTariffErrors(option: TariffOption, prices: MyTariffPrices) {
  const errors: Partial<Record<MyTariffField, "required" | "outOfRange">> = {};
  const check = (field: MyTariffField, value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) errors[field] = "required";
    else if (value < 0 || value > 5) errors[field] = "outOfRange";
  };
  check("powerPerDay", prices.powerPerDay);
  for (let i = 0; i < OPTION_PERIODS[option]; i++) check(`energy${i}`, prices.energy[i]);
  return errors;
}

/**
 * The visitor's tariff as an offer the engine prices like any other: same taxes, no services,
 * refunds or discounts, open to social-tariff customers.
 */
export function myTariffOffer(
  contractedPower: ContractedPowerKva,
  option: TariffOption,
  prices: MyTariffPrices,
): ElectricityOffer {
  const [first = 0, second = 0, third = 0] = prices.energy;
  const { powerPerDay } = prices;
  const optionPrices =
    option === "simple"
      ? { simple: { powerPerDay, energy: first } }
      : option === "biHourly"
        ? { biHourly: { powerPerDay, offValley: first, valley: second } }
        : { triHourly: { powerPerDay, peak: first, shoulder: second, valley: third } };
  const none = { fixedPerYear: 0, powerPercent: 0, energyPercent: 0, energyPerKwh: 0 };
  return {
    id: MY_TARIFF_ID,
    supplier: MY_TARIFF_ID,
    name: MY_TARIFF_ID,
    regulated: false,
    dual: false,
    segment: "domestic",
    indexed: false,
    renewable: false,
    conditioned: false,
    loyalty: false,
    socialTariff: true,
    durationMonths: null,
    validFrom: "2000-01-01",
    validTo: null,
    minAnnualKwh: null,
    maxAnnualKwh: null,
    mandatoryServicesPerYear: 0,
    refunds: none,
    newClient: none,
    requirements: { directDebit: false, eInvoice: false },
    conditions: "",
    notes: "",
    links: {},
    prices: { [contractedPower]: optionPrices },
  };
}

// ---------------------------------------------------------------------------------------------
// The comparison the page shows

export interface ComparatorRequest {
  offers: readonly ElectricityOffer[];
  consumption: PeriodKwh;
  contractedPower: ContractedPowerKva;
  cycle: HourlyCycle;
  /** The option the list is priced on (the visitor's). */
  option: TariffOption;
  socialTariff: boolean;
  largeFamily: boolean;
  newClient: boolean;
  includeRefunds: boolean;
  includeConditioned: boolean;
  includeDual: boolean;
  cheapestPerSupplier: boolean;
  sortBy: ComparisonSort;
  filters: OfferFilters;
  /** The visitor's own prices for `option`, or null. */
  myTariff: MyTariffPrices | null;
  /** Price indexed offers with a published formula from OMIE's prices (indexedPricing.ts). */
  indexedPricing?: IndexedPricing;
}

export interface RankedOffer extends OfferComparison {
  /** What the offer saves against the visitor's tariff on the `sortBy` total (negative: dearer). */
  saving: number | null;
}

export interface ComparatorView {
  /** Offers on the visitor's option, cheapest first. */
  results: RankedOffer[];
  /** The cheapest offer of each option on the same consumption, for the comparison across options. */
  best: Record<TariffOption, OfferComparison | null>;
  /** The visitor's tariff priced on the same consumption, or null. */
  mine: OfferComparison | null;
  annualKwh: number;
  socialTariffApplied: boolean;
}

export type ComparatorOutcome =
  | { ok: true; view: ComparatorView }
  | { ok: false; errors: Partial<Record<TariffComparisonField, TariffComparisonError>> };

export function runComparator(request: ComparatorRequest): ComparatorOutcome {
  const offers = filterOffers(request.offers, request.filters);
  const base = {
    contractedPower: request.contractedPower,
    kwh: request.consumption,
    cycle: request.cycle,
    socialTariff: request.socialTariff,
    largeFamily: request.largeFamily,
    newClient: request.newClient,
    includeRefunds: request.includeRefunds,
    includeConditioned: request.includeConditioned,
    includeDual: request.includeDual,
    sortBy: request.sortBy,
    indexedPricing: request.indexedPricing,
  };
  const list = compareElectricityOffers(offers, {
    ...base,
    options: [request.option],
    cheapestPerSupplier: request.cheapestPerSupplier,
  });
  if (!list.ok) return list;
  const across = compareElectricityOffers(offers, { ...base, options: TARIFF_OPTIONS });
  if (!across.ok) return across;

  const best = { simple: null, biHourly: null, triHourly: null } as ComparatorView["best"];
  for (const result of across.result.results) best[result.option] ??= result;

  let mine: OfferComparison | null = null;
  if (request.myTariff && Object.keys(myTariffErrors(request.option, request.myTariff)).length === 0) {
    const own = compareElectricityOffers([myTariffOffer(request.contractedPower, request.option, request.myTariff)], {
      ...base,
      options: [request.option],
    });
    if (own.ok) mine = own.result.results[0] ?? null;
  }
  const sortBy = request.sortBy;
  const results = list.result.results.map((result) => ({
    ...result,
    saving: mine ? Math.round((mine[sortBy].total - result[sortBy].total) * 100) / 100 : null,
  }));

  return {
    ok: true,
    view: {
      results,
      best,
      mine,
      annualKwh: list.result.annualKwh,
      socialTariffApplied: list.result.socialTariffApplied,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CSV export

export interface CsvLabels {
  rank: string;
  supplier: string;
  offer: string;
  option: string;
  firstYear: string;
  laterYears: string;
  period: string;
  estimated: string;
  /** The price-basis column's header. */
  priceBasis: string;
  saving: string;
  link: string;
  options: Record<TariffOption, string>;
  yes: string;
  no: string;
  /** The supplier's display name for a result (the regulated tariff has its own label). */
  supplierOf: (offer: ElectricityOffer) => string;
  /** How a result was priced, in words: fixed, ERSE's estimate, or OMIE's real cost with its months. */
  basisOf: (result: RankedOffer) => string;
}

/** Comma and decimal point in English; semicolon and decimal comma where the comma is decimal. */
export function csvConventions(lang: string) {
  return lang === "en" ? { separator: ",", decimal: "." } : { separator: ";", decimal: "," };
}

/**
 * The results as CSV text (a byte-order mark first, for spreadsheet apps), one row per offer in
 * the list's order. Amounts in euro with two decimals, VAT included.
 */
export function comparisonCsv(results: readonly RankedOffer[], lang: string, labels: CsvLabels): string {
  const { separator, decimal } = csvConventions(lang);
  const cell = (value: string) =>
    /["\r\n]/.test(value) || value.includes(separator) ? `"${value.replace(/"/g, '""')}"` : value;
  const amount = (value: number) => value.toFixed(2).replace(".", decimal);
  const withSaving = results.some((result) => result.saving !== null);
  const header = [
    labels.rank,
    labels.supplier,
    labels.offer,
    labels.option,
    labels.firstYear,
    labels.laterYears,
    labels.period,
    labels.estimated,
    labels.priceBasis,
    ...(withSaving ? [labels.saving] : []),
    labels.link,
  ];
  const rows = results.map((result, index) => [
    String(index + 1),
    labels.supplierOf(result.offer),
    result.offer.name,
    labels.options[result.option],
    amount(result.firstYear.total),
    amount(result.laterYears.total),
    amount(result.period.total),
    result.estimated ? labels.yes : labels.no,
    labels.basisOf(result),
    ...(withSaving ? [result.saving === null ? "" : amount(result.saving)] : []),
    result.offer.links.offer ?? result.offer.links.supplier ?? "",
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(separator)).join("\r\n")}\r\n`;
}

/** An ISO month ("2026-10") in words ("outubro de 2026"), the same in Node and browsers (UTC). */
export function formatIsoMonth(locale: Lang, iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(toIntlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** An ISO day in words ("17 de novembro de 2026"), the same in Node and browsers (UTC). */
export function formatIsoDate(locale: Lang, iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(toIntlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}
