// Ranks electricity offers (ERSE's offers export, see electricityOfferTypes.ts) by what each would
// really cost a household: power, energy, the audiovisual contribution (CAV), the electricity tax
// (IEC), VAT at 6% and 23%, mandatory services, and the refunds and new-client discounts ERSE's
// simulator counts. It follows the method of ERSE's simulator ("Manual do Simulador de Preços de
// Energia", June 2026, pages 15 to 19) and was checked against the simulator's own figures
// (electricityTariffComparison.test.ts). The tax rules and their legal sources are in
// data/erseTariffs.ts and electricityTaxes.ts. Educational estimate, not advice.
//
// How the offer data is read (ERSE's CSV columns, as electricityOfferTypes.ts maps them):
// - Prices are before VAT and taxes. Indexed offers carry ERSE's estimate (the three-month futures
//   average, one price for the twelve months), so their results are marked `estimated`. With
//   `indexedPricing`, an indexed offer whose supplier publishes its formula is priced instead from
//   OMIE's real prices (indexedPricing.ts, data/indexedFormulas.ts): its energy prices are replaced,
//   everything else is billed as below, and the result says which market basis it used.
// - `mandatoryServicesPerYear` and `newClient.fixedPerYear` include VAT (ERSE's "c/IVA" columns).
//   `refunds.fixedPerYear` (ReembFixo) has no stated VAT basis: it comes off the total as a flat EUR
//   amount. ERSE's simulator does the same and books it as an amount with 23% VAT (79 EUR shows as
//   64.23 EUR before VAT and 14.77 EUR of VAT), so the breakdown splits it that way too.
// - The percentage columns are fractions, as ERSE gives them (0.02 is 2%). A percentage of the power
//   term comes off at 23%; a percentage of the energy term and an amount per kWh come off at the
//   energy's own mix of 6% and 23%, as in ERSE's simulator. Percentages apply to the offer's own
//   prices, before the social discount, as ERSE's simulator does.
// - Where a discount is more than the base it comes off (a fixed amount at 23% against a small
//   power term, say), the rest comes off the other VAT base for the same amount with VAT, so the
//   total is exact and no VAT line goes negative (ERSE's simulator lets it go negative instead).
//   Discounts never take a bill below zero, and the social discount never takes a price below zero.
// - On dual offers (electricity with gas) the fixed amounts may cover the gas contract too. They are
//   not split; dual results are flagged and left out unless asked for, as in ERSE's electricity
//   simulation.
//
// Left out: the DGEG fee (see data/erseTariffs.ts), meter rental and other charges.

import type { ContractedPowerKva, ElectricityOffer } from "./electricityOfferTypes";
import type { HourlyCycle, PeriodKwh } from "./electricityPeriods";
import { ERSE_TARIFFS } from "./data/erseTariffs";
import {
  formulaEnergyPrices,
  formulaFor,
  type IndexedFormula,
  type IndexedPricing,
  type MarketBasisKind,
} from "./indexedPricing";
import {
  DAYS_PER_YEAR,
  cavNet,
  energyVatSplit,
  iecNet,
  powerTermVatSplit,
  reducedVatKwhByPeriod,
  type VatSplit,
} from "./electricityTaxes";

export const CONTRACTED_POWER_OPTIONS_KVA: readonly ContractedPowerKva[] = [
  1.15, 2.3, 3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7, 27.6, 34.5, 41.4,
];

export type { HourlyCycle, PeriodKwh };

export type TariffOption = "simple" | "biHourly" | "triHourly";
export const TARIFF_OPTIONS: readonly TariffOption[] = ["simple", "biHourly", "triHourly"];

export type ComparisonSort = "firstYear" | "laterYears";

export interface TariffComparisonInput {
  contractedPower: ContractedPowerKva;
  /** kWh per period and the days they cover (a bill's period, or 365 for a year). */
  kwh: PeriodKwh;
  /** The visitor's hourly cycle: which split the bi-hourly and tri-hourly offers are priced on. */
  cycle: HourlyCycle;
  /**
   * Tariff options to price the offers on. Default: all three, so a household can see every option
   * side by side (ERSE's simulator also prices simple offers for a bi-hourly household).
   */
  options?: readonly TariffOption[];
  /** Social-tariff beneficiary. Applies up to 6.9 kVA only. */
  socialTariff: boolean;
  /** Household of five or more: reduced VAT up to 300 kWh per 30 days instead of 200. */
  largeFamily: boolean;
  /** Count new-client discounts (first year only). */
  newClient: boolean;
  /** Count refunds and other discounts any client gets. */
  includeRefunds: boolean;
  /** Keep offers with extra conditions that restrict who can sign up ("ofertas condicionadas"). */
  includeConditioned: boolean;
  /** Keep dual (electricity and gas) offers. Default false, as ERSE's electricity simulation. */
  includeDual?: boolean;
  /** Keep only each supplier's cheapest result (ERSE's "menor oferta do comercializador"). */
  cheapestPerSupplier?: boolean;
  /** Which total ranks the results. Default "firstYear", ERSE's annual figure. */
  sortBy?: ComparisonSort;
  /**
   * Price indexed offers that have a published formula from OMIE's real prices on this market basis
   * (the last 12 months, or a load diagram's dates), instead of ERSE's estimate. Off by default.
   */
  indexedPricing?: IndexedPricing;
}

/** One bill, in EUR. Amounts are not rounded except `total`, which is rounded to the cent. */
export interface TariffBreakdown {
  days: number;
  kwh: number;
  /** Power term before VAT, social discount taken off. */
  power: number;
  /** Energy term before VAT, social discount taken off. */
  energy: number;
  /** The social-tariff discount before VAT, already taken off `power` and `energy`. */
  socialDiscount: number;
  /** Audiovisual contribution before VAT (none below 400 kWh a year). */
  cav: number;
  /** Electricity tax before VAT (none on the social tariff). */
  iec: number;
  /** Mandatory services before VAT. */
  services: number;
  /** Refunds and discounts any client gets, before VAT, as a negative amount (or 0). */
  refunds: number;
  /** New-client discount before VAT, as a negative amount (or 0). */
  newClientDiscount: number;
  /** Everything before VAT. */
  subtotal: number;
  /** VAT at the reduced rate (6%). */
  vatReduced: number;
  /** VAT at the standard rate (23%). */
  vatStandard: number;
  /** What the bill comes to, VAT included, rounded to the cent. */
  total: number;
}

/** How an offer's energy was priced. */
export type PriceBasis = "fixed" | "erseEstimate" | "market";

/** The market an indexed offer was priced on, with the supplier's formula. */
export interface MarketPricing {
  kind: MarketBasisKind;
  /** First and last month of market prices, "YYYY-MM". */
  from: string;
  to: string;
  formula: IndexedFormula;
  /** The energy price of each period, EUR/kWh before VAT, in the order of the option's periods. */
  energy: readonly number[];
}

export interface OfferComparison {
  offer: ElectricityOffer;
  option: TariffOption;
  /** Indexed offer priced at ERSE's estimate of the coming months, not a fixed or past price. */
  estimated: boolean;
  /** "fixed": the offer's prices; "erseEstimate": ERSE's indexed estimate; "market": OMIE and formula. */
  priceBasis: PriceBasis;
  /** With `priceBasis` "market", what it was priced on. */
  market?: MarketPricing;
  /** Dual offer: needs a gas contract too, and its fixed amounts may cover gas. */
  dual: boolean;
  /** The bill for the entered days, on first-year terms. */
  period: TariffBreakdown;
  /** A year (365 days) of the same consumption, new-client discount included when it applies. */
  firstYear: TariffBreakdown;
  /** A year without the new-client discount. */
  laterYears: TariffBreakdown;
}

export interface TariffComparisonResult {
  /** Sorted by `sortBy`, cheapest first. */
  results: OfferComparison[];
  /**
   * The consumption scaled to 365 days, from the first option priced (simple, then bi-hourly, then
   * tri-hourly). Each result's own is `firstYear.kwh`.
   */
  annualKwh: number;
  /** False when the social tariff was asked for above 6.9 kVA, where it does not apply. */
  socialTariffApplied: boolean;
}

export type TariffComparisonField = "contractedPower" | "consumption" | "days";
export type TariffComparisonError = "notAllowed" | "required" | "negative" | "outOfRange";

export type TariffComparisonOutcome =
  | { ok: true; result: TariffComparisonResult }
  | { ok: false; errors: Partial<Record<TariffComparisonField, TariffComparisonError>> };

/** Longest period accepted, in days: two years, enough for any bill or meter download. */
export const TARIFF_COMPARISON_LIMITS = { maxDays: 731 } as const;

/** Rounds to the cent; the nudge keeps an exact half cent from rounding down on float error. */
const cents = (value: number) => Math.round(value * 100 + 1e-7) / 100;

/** The kWh of each of `option`'s periods, in the order of the offer's prices. */
export function kwhByPeriod(kwh: PeriodKwh, cycle: HourlyCycle, option: TariffOption): number[] {
  switch (option) {
    case "simple":
      return [kwh.simple.energy];
    case "biHourly":
      return [kwh[cycle].biHourly.offValley, kwh[cycle].biHourly.valley];
    case "triHourly": {
      const { peak, shoulder, valley } = kwh[cycle].triHourly;
      return [peak, shoulder, valley];
    }
  }
}

function offerPrices(offer: ElectricityOffer, power: ContractedPowerKva, option: TariffOption) {
  const prices = offer.prices[power];
  switch (option) {
    case "simple":
      return prices?.simple ? { powerPerDay: prices.simple.powerPerDay, energy: [prices.simple.energy] } : null;
    case "biHourly":
      return prices?.biHourly
        ? { powerPerDay: prices.biHourly.powerPerDay, energy: [prices.biHourly.offValley, prices.biHourly.valley] }
        : null;
    case "triHourly":
      return prices?.triHourly
        ? {
            powerPerDay: prices.triHourly.powerPerDay,
            energy: [prices.triHourly.peak, prices.triHourly.shoulder, prices.triHourly.valley],
          }
        : null;
  }
}

interface Discounts {
  fixedPerYear: number;
  powerPercent: number;
  energyPercent: number;
  energyPerKwh: number;
}

/**
 * A discount of the offer's kinds over `days` days, before VAT, split by the VAT rate it takes off.
 * `fixedPerYear` includes VAT at 23%.
 */
function discountSplit(
  discounts: Discounts,
  { days, kwh, powerNet, energy }: { days: number; kwh: number; powerNet: number; energy: VatSplit },
): VatSplit {
  const energyNet = energy.reduced + energy.standard;
  const onEnergy = energyNet * discounts.energyPercent + kwh * discounts.energyPerKwh;
  const reducedShare = energyNet > 0 ? energy.reduced / energyNet : 0;
  const fixed = ((discounts.fixedPerYear / (1 + ERSE_TARIFFS.vat.standard)) * days) / DAYS_PER_YEAR;
  return {
    reduced: onEnergy * reducedShare,
    standard: onEnergy * (1 - reducedShare) + powerNet * discounts.powerPercent + fixed,
  };
}

interface BillTerms {
  contractedPower: ContractedPowerKva;
  days: number;
  kwhByPeriod: readonly number[];
  socialTariff: boolean;
  largeFamily: boolean;
  newClient: boolean;
  includeRefunds: boolean;
}

const VAT_FACTOR = { reduced: 1 + ERSE_TARIFFS.vat.reduced, standard: 1 + ERSE_TARIFFS.vat.standard };
const withVat = (split: VatSplit) => split.reduced * VAT_FACTOR.reduced + split.standard * VAT_FACTOR.standard;

/**
 * Takes a discount off the bill's two VAT bases (amounts before VAT) and returns what it really
 * takes off each. Each part comes off the base ERSE books it on, but no base goes below zero: what a
 * part would take beyond its base moves to the other base, for the same amount with VAT, so the
 * total stays exact and neither VAT line turns negative. What is left once both bases are at zero is
 * dropped: a bill never goes below zero. ERSE's simulator does not floor it (on 2026-11-20 it showed
 * -25.25 EUR a year for EDPC_36 at 1.15 kVA and no consumption, with negative taxes), but a discount
 * spread over the bills cannot pay out more than the bills.
 */
function applyDiscount(base: VatSplit, discount: VatSplit): VatSplit {
  let { reduced, standard } = discount;
  if (standard > base.standard) {
    reduced += ((standard - base.standard) * VAT_FACTOR.standard) / VAT_FACTOR.reduced;
    standard = base.standard;
  }
  if (reduced > base.reduced) {
    standard += ((reduced - base.reduced) * VAT_FACTOR.reduced) / VAT_FACTOR.standard;
    reduced = base.reduced;
  }
  return { reduced, standard: Math.min(standard, base.standard) };
}

function priceBill(
  offer: ElectricityOffer,
  prices: { powerPerDay: number; energy: readonly number[] },
  terms: BillTerms,
): TariffBreakdown {
  const { contractedPower, days, kwhByPeriod, socialTariff } = terms;
  const { vat, socialTariff: social } = ERSE_TARIFFS;
  const kwh = kwhByPeriod.reduce((sum, value) => sum + value, 0);

  // The social discount never takes a price below zero.
  const powerDiscount = socialTariff
    ? Math.min(social.powerPerDay[contractedPower] ?? 0, Math.max(0, prices.powerPerDay))
    : 0;
  const energyDiscounts = prices.energy.map((price) =>
    socialTariff ? Math.min(social.energyPerKwh, Math.max(0, price)) : 0,
  );
  const powerNet = (prices.powerPerDay - powerDiscount) * days;
  const energyPrices = prices.energy.map((price, index) => price - energyDiscounts[index]);

  const reducedKwh = reducedVatKwhByPeriod(kwhByPeriod, {
    contractedPower,
    days,
    largeFamily: terms.largeFamily,
    roundToKwh: true,
  });
  const energy = energyVatSplit(kwhByPeriod, energyPrices, reducedKwh);
  const power = powerTermVatSplit(powerNet, { contractedPower, days, socialTariff });
  const cav = cavNet({ days, annualKwh: (kwh * DAYS_PER_YEAR) / days, reduced: socialTariff });
  const iec = iecNet(kwh, socialTariff);
  const services = ((offer.mandatoryServicesPerYear / VAT_FACTOR.standard) * days) / DAYS_PER_YEAR;
  const base: VatSplit = {
    reduced: power.reduced + energy.reduced + cav,
    standard: power.standard + energy.standard + iec + services,
  };

  // ERSE takes refund and discount percentages off the offer's own prices, before the social
  // discount (REPSOL_125 refunds 8.57 EUR a year with or without the social tariff).
  const discountBase = {
    days,
    kwh,
    powerNet: prices.powerPerDay * days,
    energy: energyVatSplit(kwhByPeriod, prices.energy, reducedKwh),
  };
  const none: VatSplit = { reduced: 0, standard: 0 };
  const refunds = terms.includeRefunds ? discountSplit(offer.refunds, discountBase) : none;
  const newClient = terms.newClient ? discountSplit(offer.newClient, discountBase) : none;
  const applied = applyDiscount(base, {
    reduced: refunds.reduced + newClient.reduced,
    standard: refunds.standard + newClient.standard,
  });
  // What was taken off, shared between refunds and new-client discount by what each asked for.
  const appliedNet = applied.reduced + applied.standard;
  const asked = withVat(refunds) + withVat(newClient);
  const refundsShare = asked > 0 ? withVat(refunds) / asked : 0;

  const reducedNet = base.reduced - applied.reduced;
  const standardNet = base.standard - applied.standard;
  const vatReduced = reducedNet * vat.reduced;
  const vatStandard = standardNet * vat.standard;
  const subtotal = reducedNet + standardNet;

  return {
    days,
    kwh,
    power: powerNet,
    energy: energy.reduced + energy.standard,
    socialDiscount:
      powerDiscount * days + energyDiscounts.reduce((sum, discount, index) => sum + discount * kwhByPeriod[index], 0),
    cav,
    iec,
    services,
    refunds: 0 - appliedNet * refundsShare,
    newClientDiscount: 0 - appliedNet * (1 - refundsShare),
    subtotal,
    vatReduced,
    vatStandard,
    total: cents(subtotal + vatReduced + vatStandard),
  };
}

function validate(input: TariffComparisonInput, options: readonly TariffOption[]) {
  const errors: Partial<Record<TariffComparisonField, TariffComparisonError>> = {};
  if (!CONTRACTED_POWER_OPTIONS_KVA.includes(input.contractedPower)) errors.contractedPower = "notAllowed";
  const { days } = input.kwh;
  if (!Number.isFinite(days)) errors.days = "required";
  else if (days <= 0 || days > TARIFF_COMPARISON_LIMITS.maxDays) errors.days = "outOfRange";
  const kwh = options.flatMap((option) => kwhByPeriod(input.kwh, input.cycle, option));
  if (kwh.some((value) => !Number.isFinite(value))) errors.consumption = "required";
  else if (kwh.some((value) => value < 0)) errors.consumption = "negative";
  return errors;
}

/** Whether the offer is shown at all, before pricing. */
function eligible(offer: ElectricityOffer, input: TariffComparisonInput, socialTariff: boolean) {
  if (offer.conditioned && !input.includeConditioned) return false;
  if (offer.dual && !input.includeDual) return false;
  // Offers that do not take social-tariff customers are left out for them.
  if (socialTariff && !offer.socialTariff) return false;
  return true;
}

/** The first, so cheapest, result of each supplier in an already sorted list. */
function cheapestOfEachSupplier(sorted: readonly OfferComparison[]) {
  const seen = new Set<string>();
  return sorted.filter(({ offer }) => {
    if (seen.has(offer.supplier)) return false;
    seen.add(offer.supplier);
    return true;
  });
}

/** An indexed offer's energy prices from its formula and the market basis, or null. */
function marketPrices(offer: ElectricityOffer, input: TariffComparisonInput, option: TariffOption): MarketPricing | null {
  const pricing = input.indexedPricing;
  if (!pricing) return null;
  const formula = formulaFor(pricing.formulas, offer.id);
  if (!formula) return null;
  const energy = formulaEnergyPrices(formula, pricing.basis, input.contractedPower, option, input.cycle);
  if (!energy) return null;
  const { kind, from, to } = pricing.basis;
  return { kind, from, to, formula, energy };
}

export function compareElectricityOffers(
  offers: readonly ElectricityOffer[],
  input: TariffComparisonInput,
): TariffComparisonOutcome {
  const options = TARIFF_OPTIONS.filter((option) => (input.options ?? TARIFF_OPTIONS).includes(option));
  const errors = validate(input, options);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const { contractedPower } = input;
  const { days } = input.kwh;
  const socialTariff = input.socialTariff && contractedPower <= ERSE_TARIFFS.socialTariff.upToKva;
  const scale = DAYS_PER_YEAR / days;
  const sortBy = input.sortBy ?? "firstYear";

  const results: OfferComparison[] = [];
  for (const offer of offers) {
    if (!eligible(offer, input, socialTariff)) continue;
    for (const option of options) {
      const listed = offerPrices(offer, contractedPower, option);
      if (!listed) continue;
      const market = offer.indexed ? marketPrices(offer, input, option) : null;
      const prices = market ? { powerPerDay: listed.powerPerDay, energy: market.energy } : listed;
      const terms: BillTerms = {
        contractedPower,
        days,
        kwhByPeriod: kwhByPeriod(input.kwh, input.cycle, option),
        socialTariff,
        largeFamily: input.largeFamily,
        newClient: input.newClient,
        includeRefunds: input.includeRefunds,
      };
      const year = { ...terms, days: DAYS_PER_YEAR, kwhByPeriod: terms.kwhByPeriod.map((kwh) => kwh * scale) };
      results.push({
        offer,
        option,
        estimated: offer.indexed && !market,
        priceBasis: market ? "market" : offer.indexed ? "erseEstimate" : "fixed",
        ...(market ? { market } : {}),
        dual: offer.dual,
        period: priceBill(offer, prices, terms),
        firstYear: priceBill(offer, prices, year),
        laterYears: priceBill(offer, prices, { ...year, newClient: false }),
      });
    }
  }

  results.sort(
    (a, b) =>
      a[sortBy].total - b[sortBy].total ||
      a.offer.id.localeCompare(b.offer.id) ||
      TARIFF_OPTIONS.indexOf(a.option) - TARIFF_OPTIONS.indexOf(b.option),
  );
  const kept = input.cheapestPerSupplier ? cheapestOfEachSupplier(results) : results;

  // From the periods priced: the first option's (simple, then bi-hourly, then tri-hourly).
  const pricedKwh = options.length > 0 ? kwhByPeriod(input.kwh, input.cycle, options[0]) : [];
  const annualKwh = pricedKwh.reduce((sum, kwh) => sum + kwh, 0) * scale;
  return { ok: true, result: { results: kept, annualKwh, socialTariffApplied: socialTariff } };
}
