// The taxes on a low-voltage household electricity bill in mainland Portugal, shared by the
// regulated-tariff bill estimator (electricityBill.ts) and the offer comparison
// (electricityTariffComparison.ts). Rates, thresholds and their legal sources are in
// data/erseTariffs.ts. Every amount here is in EUR before VAT unless its name says otherwise.

import { ERSE_TARIFFS } from "./data/erseTariffs";

const { vat } = ERSE_TARIFFS;

/** Net amounts split by the VAT rate they pay. */
export interface VatSplit {
  /** Taxed at the reduced rate (6%). */
  reduced: number;
  /** Taxed at the standard rate (23%). */
  standard: number;
}

/** kWh that get the reduced rate in a period of `days` (Lista I, verba 2.38; ERSExplica p. 7). */
export function reducedVatAllowanceKwh(contractedPower: number, days: number, largeFamily: boolean) {
  if (contractedPower > vat.energyReducedUpToKva) return 0;
  const per30 = largeFamily ? vat.reducedKwhPer30DaysLargeFamily : vat.reducedKwhPer30Days;
  return (per30 * days) / vat.thresholdDays;
}

/**
 * kWh of each period (simple: one, bi-hourly: two, tri-hourly: three) that get the reduced VAT rate.
 * The allowance is shared in proportion to each period's kWh (ERSExplica p. 8). With
 * `roundToKwh`, each period's threshold is rounded to the whole kWh, as ERSExplica allows and as
 * ERSE's simulator does.
 */
export function reducedVatKwhByPeriod(
  kwhByPeriod: readonly number[],
  { contractedPower, days, largeFamily, roundToKwh }: {
    contractedPower: number;
    days: number;
    largeFamily: boolean;
    roundToKwh: boolean;
  },
) {
  const total = kwhByPeriod.reduce((sum, kwh) => sum + kwh, 0);
  const allowance = reducedVatAllowanceKwh(contractedPower, days, largeFamily);
  if (total <= 0 || allowance <= 0) return kwhByPeriod.map(() => 0);
  return kwhByPeriod.map((kwh) => {
    const threshold = (allowance * kwh) / total;
    return Math.min(kwh, roundToKwh ? Math.round(threshold) : threshold);
  });
}

/**
 * Splits a net amount for energy by VAT rate, given the kWh in each period, their prices and the
 * kWh of each period within the reduced-rate allowance.
 */
export function energyVatSplit(
  kwhByPeriod: readonly number[],
  pricesByPeriod: readonly number[],
  reducedKwhByPeriod: readonly number[],
): VatSplit {
  let reduced = 0;
  let standard = 0;
  kwhByPeriod.forEach((kwh, index) => {
    const price = pricesByPeriod[index];
    const reducedKwh = reducedKwhByPeriod[index];
    reduced += reducedKwh * price;
    standard += (kwh - reducedKwh) * price;
  });
  return { reduced, standard };
}

/**
 * The network-access tariff's fixed term, EUR per day, where it pays the reduced VAT rate (contracted
 * power up to 3,45 kVA, Lista I verba 2.33), after the social-tariff discount when it applies;
 * otherwise 0.
 */
export function reducedVatTarPerDay(contractedPower: number, socialTariff: boolean) {
  if (contractedPower > vat.powerTermReducedUpToKva) return 0;
  const tar = ERSE_TARIFFS.tarPowerPerDay[contractedPower];
  if (tar === undefined) throw new Error(`No TAR fixed term for ${contractedPower} kVA`);
  const discount = socialTariff ? (ERSE_TARIFFS.socialTariff.powerPerDay[contractedPower] ?? 0) : 0;
  return tar - discount;
}

/**
 * Splits the power term by VAT rate: the TAR fixed term at the reduced rate up to 3,45 kVA, the rest
 * of the price at the standard rate. `powerNet` is what the customer pays before VAT for `days`
 * days, social discount already taken off. The reduced part never exceeds it.
 */
export function powerTermVatSplit(
  powerNet: number,
  { contractedPower, days, socialTariff }: { contractedPower: number; days: number; socialTariff: boolean },
): VatSplit {
  const reduced = Math.min(powerNet, reducedVatTarPerDay(contractedPower, socialTariff) * days);
  return { reduced, standard: powerNet - reduced };
}

/** Days in the year the comparison and ERSE's simulator use. */
export const DAYS_PER_YEAR = 365;

/**
 * Contribuição para o Audiovisual for a period of `days` days, before its 6% VAT: the monthly amount
 * times 12 months a year, prorated by day. None when the annual consumption is below 400 kWh; the
 * reduced amount for social-tariff beneficiaries.
 */
export function cavNet({ days, annualKwh, reduced }: { days: number; annualKwh: number; reduced: boolean }) {
  if (annualKwh < ERSE_TARIFFS.cavExemptBelowKwhPerYear) return 0;
  const perMonth = reduced ? ERSE_TARIFFS.cavPerMonthReduced : ERSE_TARIFFS.cavPerMonth;
  return (perMonth * 12 * days) / DAYS_PER_YEAR;
}

/** Imposto Especial de Consumo, before its 23% VAT; social-tariff customers are exempt. */
export const iecNet = (kwh: number, exempt = false) => (exempt ? 0 : kwh * ERSE_TARIFFS.iecPerKwh);
