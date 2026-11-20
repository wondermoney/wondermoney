import {
  CONTRACTED_POWERS_KVA,
  ERSE_TARIFFS,
  type ContractedPower,
} from "./data/erseTariffs";
import { energyVatSplit, iecNet, powerTermVatSplit, reducedVatKwhByPeriod } from "./electricityTaxes";
import {
  ELECTRICITY_PRICES,
  ELECTRICITY_PRICES_SOURCE,
  type ElectricityPriceRow,
} from "./data/electricityPrices";

export { CONTRACTED_POWERS_KVA, ELECTRICITY_PRICES, ELECTRICITY_PRICES_SOURCE, ERSE_TARIFFS };
export type { ContractedPower };

/** The bill is for a standard 30-day month, the unit ERSE's reduced-VAT thresholds use. */
export const BILL_DAYS = 30;

export const ELECTRICITY_BILL_LIMITS = {
  maxMonthlyKwh: 20_000,
  maxAnnualKwh: 240_000,
} as const;

export type TariffOption = "simple" | "biHourly";
export type ConsumptionPeriod = "month" | "year";

export interface ElectricityBillInput {
  contractedPower: number;
  /** kWh in the period chosen by `period`. */
  consumption: number;
  period: ConsumptionPeriod;
  option: TariffOption;
  /** Share of the consumption in the off-peak ("vazio") hours, 0 to 100. Bi-hourly only. */
  offPeakPercent: number;
  /** Household of five or more people: reduced VAT applies up to 300 kWh instead of 200. */
  largeFamily: boolean;
}

export type ElectricityBillField = "contractedPower" | "consumption" | "offPeakPercent";
export type ElectricityBillError = "required" | "notAllowed" | "negative" | "tooLarge" | "percentRange";

export const ELECTRICITY_BILL_EXAMPLE: ElectricityBillInput = {
  contractedPower: 3.45,
  consumption: 158,
  period: "month",
  option: "simple",
  offPeakPercent: 35,
  largeFamily: false,
};

export interface BillLine {
  /** Amount before VAT, in euro. */
  net: number;
  /** VAT rate applied, 0.06 or 0.23. */
  vatRate: number;
}

export interface BillBreakdown {
  /**
   * The network-access tariff's fixed term within the power price, at the reduced VAT rate (contracted
   * power up to 3.45 kVA, Código do IVA Lista I verba 2.33). Zero above 3.45 kVA.
   */
  powerNetwork: BillLine;
  /** The rest of the contracted power price for 30 days (all of it above 3.45 kVA), at 23%. */
  power: BillLine;
  /** Energy within the reduced-VAT allowance. */
  energyReduced: BillLine;
  /** Energy above it. */
  energyStandard: BillLine;
  cav: BillLine;
  iec: BillLine;
}

export interface ElectricityBillResult {
  monthlyKwh: number;
  breakdown: BillBreakdown;
  /** Before VAT. */
  subtotal: number;
  vat: number;
  /** What the month's bill comes to, VAT included, rounded to the cent. */
  total: number;
  /** Total divided by the kWh used: what each kWh really costs once the fixed parts are spread. */
  effectivePerKwh: number | null;
  /** Roughly twelve such months. */
  yearly: number;
  /** Energy kWh that fall within the reduced-VAT allowance. */
  reducedKwh: number;
  /** The same month on the other tariff option, to compare. */
  alternative: { option: TariffOption; total: number } | null;
  /** Off-peak share, in percent, above which bi-hourly is cheaper than simple. */
  breakEvenOffPeakPercent: number;
}

export type ElectricityBillOutcome =
  | { ok: true; result: ElectricityBillResult }
  | { ok: false; errors: Partial<Record<ElectricityBillField, ElectricityBillError>> };

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function validate(input: ElectricityBillInput) {
  const errors: Partial<Record<ElectricityBillField, ElectricityBillError>> = {};
  if (!(CONTRACTED_POWERS_KVA as readonly number[]).includes(input.contractedPower)) {
    errors.contractedPower = "notAllowed";
  }
  const max =
    input.period === "month" ? ELECTRICITY_BILL_LIMITS.maxMonthlyKwh : ELECTRICITY_BILL_LIMITS.maxAnnualKwh;
  if (!Number.isFinite(input.consumption)) errors.consumption = "required";
  else if (input.consumption < 0) errors.consumption = "negative";
  else if (input.consumption > max) errors.consumption = "tooLarge";
  if (input.option === "biHourly") {
    if (!Number.isFinite(input.offPeakPercent)) errors.offPeakPercent = "required";
    else if (input.offPeakPercent < 0 || input.offPeakPercent > 100) errors.offPeakPercent = "percentRange";
  }
  return errors;
}

/** Off-peak share, in percent, where the bi-hourly and simple energy prices cost the same. */
export function breakEvenOffPeakPercent() {
  const { simple, biPeak, biOffPeak } = ERSE_TARIFFS.energyPerKwh;
  return ((biPeak - simple) / (biPeak - biOffPeak)) * 100;
}

function energyPeriods(option: TariffOption, kwh: number, offPeakShare: number) {
  const { simple, biPeak, biOffPeak } = ERSE_TARIFFS.energyPerKwh;
  if (option === "simple") return { kwh: [kwh], prices: [simple] };
  return { kwh: [kwh * (1 - offPeakShare), kwh * offPeakShare], prices: [biPeak, biOffPeak] };
}

function bill(
  power: number,
  option: TariffOption,
  monthlyKwh: number,
  offPeakShare: number,
  largeFamily: boolean,
) {
  const { vat, powerPerDay, cavPerMonth } = ERSE_TARIFFS;
  const powerKey = power as ContractedPower;
  // Energy up to the allowance gets 6% VAT (contracted power up to 6.9 kVA, all four options).
  // With two prices the allowance is shared in proportion to the kWh in each period.
  const periods = energyPeriods(option, monthlyKwh, offPeakShare);
  const reducedByPeriod = reducedVatKwhByPeriod(periods.kwh, {
    contractedPower: power,
    days: BILL_DAYS,
    largeFamily,
    roundToKwh: false,
  });
  const reducedKwh = reducedByPeriod.reduce((sum, kwh) => sum + kwh, 0);
  const energy = energyVatSplit(periods.kwh, periods.prices, reducedByPeriod);
  const powerTerm = powerTermVatSplit(powerPerDay[powerKey] * BILL_DAYS, {
    contractedPower: power,
    days: BILL_DAYS,
    socialTariff: false,
  });

  const breakdown: BillBreakdown = {
    powerNetwork: { net: powerTerm.reduced, vatRate: vat.reduced },
    power: { net: powerTerm.standard, vatRate: vat.standard },
    energyReduced: { net: energy.reduced, vatRate: vat.reduced },
    energyStandard: { net: energy.standard, vatRate: vat.standard },
    cav: { net: cavPerMonth, vatRate: vat.reduced },
    iec: { net: iecNet(monthlyKwh), vatRate: vat.standard },
  };
  const lines = Object.values(breakdown);
  const subtotal = lines.reduce((sum, line) => sum + line.net, 0);
  const vatAmount = lines.reduce((sum, line) => sum + line.net * line.vatRate, 0);
  return { breakdown, subtotal, vatAmount, total: subtotal + vatAmount, reducedKwh };
}

export function computeElectricityBill(input: ElectricityBillInput): ElectricityBillOutcome {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const monthlyKwh = input.period === "year" ? input.consumption / 12 : input.consumption;
  const share = input.option === "biHourly" ? input.offPeakPercent / 100 : 0;
  const main = bill(input.contractedPower, input.option, monthlyKwh, share, input.largeFamily);

  const otherOption: TariffOption = input.option === "simple" ? "biHourly" : "simple";
  // The comparison keeps the entered off-peak share (the field keeps its value while hidden).
  const otherShare = otherOption === "biHourly" ? input.offPeakPercent / 100 : 0;
  const other = bill(input.contractedPower, otherOption, monthlyKwh, otherShare, input.largeFamily);
  const offPeakKnown = Number.isFinite(input.offPeakPercent) && input.offPeakPercent >= 0 && input.offPeakPercent <= 100;

  const total = cents(main.total);
  return {
    ok: true,
    result: {
      monthlyKwh,
      breakdown: main.breakdown,
      subtotal: cents(main.subtotal),
      vat: cents(main.vatAmount),
      total,
      effectivePerKwh: monthlyKwh > 0 ? main.total / monthlyKwh : null,
      yearly: cents(main.total * 12),
      reducedKwh: main.reducedKwh,
      alternative: offPeakKnown ? { option: otherOption, total: cents(other.total) } : null,
      breakEvenOffPeakPercent: breakEvenOffPeakPercent(),
    },
  };
}

export interface ElectricityIndexPoint {
  period: string;
  /** "2024 S1" style label. */
  label: string;
  portugal: number;
  eu: number;
  /** Portugal's price relative to the EU average, in percent (negative: cheaper). */
  gapPercent: number;
}

export function electricityIndexSeries(
  rows: readonly ElectricityPriceRow[] = ELECTRICITY_PRICES,
): ElectricityIndexPoint[] {
  return rows.map(([period, portugal, eu]) => ({
    period,
    label: period.replace("-S", " S"),
    portugal,
    eu,
    gapPercent: (portugal / eu - 1) * 100,
  }));
}
