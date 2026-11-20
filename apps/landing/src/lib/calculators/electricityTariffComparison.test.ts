import { describe, expect, it } from "vitest";
import type { ElectricityOffer } from "./electricityOfferTypes";
import {
  CONTRACTED_POWER_OPTIONS_KVA,
  compareElectricityOffers,
  type OfferComparison,
  type PeriodKwh,
  type TariffComparisonInput,
} from "./electricityTariffComparison";
import {
  ERSE_FORM,
  ERSE_NO_SOCIAL_TARIFF_ABOVE_6_9,
  ERSE_READINGS,
  FIXTURE_OFFERS,
  type ErseReading,
} from "./electricityTariffComparison.fixtures";

const offer = (id: string) => {
  const found = FIXTURE_OFFERS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No fixture offer ${id}`);
  return found;
};

/** kWh in the PeriodKwh shape; the tri-hourly split puts the off-valley kWh in "cheias". */
function periodKwh(days: number, split: { simple: number } | { offValley: number; valley: number }): PeriodKwh {
  const [offValley, valley] = "simple" in split ? [split.simple, 0] : [split.offValley, split.valley];
  const cycle = { biHourly: { offValley, valley }, triHourly: { peak: 0, shoulder: offValley, valley } };
  return { days, simple: { energy: offValley + valley }, daily: cycle, weekly: cycle };
}

const DEFAULTS: Omit<TariffComparisonInput, "contractedPower" | "kwh"> = {
  cycle: "daily",
  socialTariff: false,
  largeFamily: false,
  newClient: false,
  includeRefunds: false,
  includeConditioned: true,
};

function run(offers: readonly ElectricityOffer[], input: Partial<TariffComparisonInput> & Pick<TariffComparisonInput, "kwh">) {
  const outcome = compareElectricityOffers(offers, { contractedPower: 3.45, ...DEFAULTS, ...input });
  if (!outcome.ok) throw new Error(`unexpected errors ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
}

const only = (results: readonly OfferComparison[]) => {
  expect(results).toHaveLength(1);
  return results[0];
};

/** The engine input for one of ERSE's simulator requests. */
function inputFor(reading: ErseReading): TariffComparisonInput {
  const form = { ...ERSE_FORM, ...reading.form };
  const ponta = Number(form.electPonta);
  return {
    ...DEFAULTS,
    // The simulator's power list, in its order: 1,15 kVA is index 0.
    contractedPower: CONTRACTED_POWER_OPTIONS_KVA[Number(form.electSupply)],
    // "12 meses" is a year of 365 days; "1 mês" is a twelfth of it, so the year is 12 such months.
    kwh: periodKwh(
      form.electCalendar === "0" ? 365 / 12 : 365,
      form.cycle === "1" ? { simple: ponta } : { offValley: ponta, valley: Number(form.electCheias) },
    ),
    options: [reading.option],
    socialTariff: form.socialOffer === "2",
    largeFamily: form.filtro_FamiliasNumerosas === "1",
    newClient: form.filtro_NovosClientes === "1",
    includeRefunds: form.filtro_SemReembolsos === "1",
    includeConditioned: form.filtro_SemRestricoesAdicionais === "1",
  };
}

describe("compareElectricityOffers against ERSE's simulator (read on 2026-11-20)", () => {
  // ERSE rounds each parcel it shows (networks, energy, taxes, services, discounts) to the cent and
  // adds the rounded parcels, so its total can be a cent away from the exact total rounded once. ERSE also takes the offer's refund per kWh (ReembW) off a second time, without VAT, when its
  // new-client filter is on, even with refunds off; the CSV's new-client amount per kWh is 0 on every
  // such offer, so the engine does not repeat it.
  const ROUNDING = 0.01 + 1e-9;

  it.each(ERSE_READINGS.map((reading) => [reading.name, reading] as const))("%s", (_name, reading) => {
    const input = inputFor(reading);
    const priced = only(run([offer(reading.offer)], input).results);
    const [network, energy, , services, discounts, total] = reading.erse;
    const annualKwh = priced.firstYear.kwh;
    const erseRepeat = input.newClient ? annualKwh * offer(reading.offer).refunds.energyPerKwh : 0;

    expect(priced.option).toBe(reading.option);
    expect(Math.abs(priced.firstYear.total - (total + erseRepeat))).toBeLessThanOrEqual(ROUNDING);
    expect(priced.firstYear.power + priced.firstYear.energy).toBeCloseTo(network + energy, 1);
    expect(priced.firstYear.services).toBeCloseTo(services, 2);
    expect(priced.firstYear.refunds + priced.firstYear.newClientDiscount).toBeCloseTo(discounts + erseRepeat, 1);
  });

  it("matches the three standard consumers' regulated tariff and two market offers to the cent", () => {
    for (const name of [
      "type 1, regulated tariff",
      "type 1, MEO",
      "type 1, EDP new-client 100 EUR, simple",
      "type 2, regulated tariff",
      "type 2, MEO",
      "type 2, GoldEnergy new client, simple",
      "type 3, regulated tariff",
      "type 3, MEO",
      "type 3, Iberdrola fixed refund, simple",
    ]) {
      const reading = ERSE_READINGS.find((candidate) => candidate.name === name) as ErseReading;
      const priced = only(run([offer(reading.offer)], inputFor(reading)).results);
      // ERSE's displayed total is the sum of its rounded parcels; the regulated tariff at 13,8 kVA
      // is the one case where that sum is a cent below the exact total (2 628.037 EUR).
      const expected = name === "type 3, regulated tariff" ? 2628.04 : reading.erse[5];
      expect(priced.firstYear.total, name).toBe(expected);
    }
  });

  it("lists nothing on the social tariff above 6.9 kVA in ERSE, and gives no social discount here", () => {
    expect(ERSE_NO_SOCIAL_TARIFF_ABOVE_6_9.results).toBe(0);
    const kwh = periodKwh(365, { simple: 1900 });
    const social = run([offer("TUR")], { contractedPower: 10.35, kwh, options: ["simple"], socialTariff: true });
    const regular = run([offer("TUR")], { contractedPower: 10.35, kwh, options: ["simple"] });
    expect(social.socialTariffApplied).toBe(false);
    expect(only(social.results).firstYear).toEqual(only(regular.results).firstYear);
    expect(only(regular.results).firstYear.total).toBe(680.75);
  });
});

describe("VAT, social tariff and large family at the power boundaries", () => {
  const year = (kwh: number) => periodKwh(365, { simple: kwh });
  const tur = (contractedPower: TariffComparisonInput["contractedPower"], kwh: number, more: Partial<TariffComparisonInput> = {}) =>
    only(run([offer("TUR")], { contractedPower, kwh: year(kwh), options: ["simple"], ...more }).results).firstYear;
  const prices = (kva: 3.45 | 6.9 | 10.35) => offer("TUR").prices[kva]!.simple!;

  it("3.45 kVA: 6% on the TAR fixed term only, 23% on the rest of the power term", () => {
    const bill = tur(3.45, 1900);
    const { powerPerDay, energy } = prices(3.45);
    const tar = 0.1718 * 365;
    // 1 900 kWh is within the year's allowance (200 kWh x 365 / 30 = 2 433 kWh): all energy at 6%.
    expect(bill.vatReduced).toBeCloseTo((tar + 1900 * energy + 34.2) * 0.06, 6);
    expect(bill.vatStandard).toBeCloseTo((powerPerDay * 365 - tar + 1.9) * 0.23, 6);
    expect(bill.total).toBe(458.59);
  });

  it("6.9 kVA: the whole power term at 23%, energy still at 6% up to the allowance", () => {
    const bill = tur(6.9, 1900);
    const { powerPerDay, energy } = prices(6.9);
    expect(bill.vatReduced).toBeCloseTo((1900 * energy + 34.2) * 0.06, 6);
    expect(bill.vatStandard).toBeCloseTo((powerPerDay * 365 + 1.9) * 0.23, 6);
  });

  it("above 6.9 kVA: no reduced rate on energy, large family or not", () => {
    const bill = tur(10.35, 1900);
    expect(bill.vatReduced).toBeCloseTo(34.2 * 0.06, 6);
    expect(tur(10.35, 1900, { largeFamily: true })).toEqual(bill);
  });

  it("large family: 300 kWh per 30 days at 6% up to 6.9 kVA", () => {
    const { energy } = prices(3.45);
    // 3 000 kWh: 2 433 at 6% normally; all of it within 300 x 365 / 30 = 3 650 for a large family.
    const normal = tur(3.45, 3000);
    const large = tur(3.45, 3000, { largeFamily: true });
    expect(normal.total - large.total).toBeCloseTo((3000 - 2433) * energy * 0.17, 1);
    expect(large.total).toBe(659.44);
    const at69 = tur(6.9, 4000, { largeFamily: true });
    expect(at69.vatReduced).toBeCloseTo((3650 * energy + 34.2) * 0.06, 6);
  });

  it("social tariff at 3.45 kVA: discount on the TAR, 6% on the discounted TAR, no IEC, CAV of 1 EUR", () => {
    const bill = tur(3.45, 1900, { socialTariff: true });
    const { powerPerDay, energy } = prices(3.45);
    expect(bill.power).toBeCloseTo((powerPerDay - 0.1083) * 365, 6);
    expect(bill.energy).toBeCloseTo(1900 * (energy - 0.0468), 6);
    expect(bill.socialDiscount).toBeCloseTo(0.1083 * 365 + 1900 * 0.0468, 6);
    expect(bill.iec).toBe(0);
    expect(bill.cav).toBeCloseTo(12, 6);
    expect(bill.vatReduced).toBeCloseTo(((0.1718 - 0.1083) * 365 + 1900 * (energy - 0.0468) + 12) * 0.06, 6);
    expect(bill.total).toBe(296.56);
  });

  it("social tariff at 6.9 kVA applies, with the 6.9 kVA discount and the power term at 23%", () => {
    const result = run([offer("TUR")], { contractedPower: 6.9, kwh: year(1900), options: ["simple"], socialTariff: true });
    expect(result.socialTariffApplied).toBe(true);
    const bill = only(result.results).firstYear;
    expect(bill.power).toBeCloseTo((0.3659 - 0.2166) * 365, 6);
    expect(bill.vatStandard).toBeCloseTo(bill.power * 0.23, 6);
  });

  it("leaves out offers that do not take the social tariff, for social-tariff customers only", () => {
    const noSocial = { ...offer("MEOENERGIA_02"), socialTariff: false };
    const kwh = year(1900);
    expect(run([noSocial], { kwh, socialTariff: true }).results).toHaveLength(0);
    expect(run([noSocial], { kwh }).results.length).toBeGreaterThan(0);
    // Above 6.9 kVA the social tariff does not apply, so nothing is left out for it.
    expect(run([noSocial], { kwh, contractedPower: 10.35, socialTariff: true }).results.length).toBeGreaterThan(0);
  });
});

describe("periods, discounts and the ranking", () => {
  const typeOne = periodKwh(365, { offValley: 1140, valley: 760 });

  it("prices a bill's period with the allowance and the annual amounts scaled to its days", () => {
    const month = periodKwh(30, { simple: 158 });
    const result = only(run([offer("TUR")], { kwh: month, options: ["simple"] }).results);
    expect(result.period.days).toBe(30);
    // 158 kWh in 30 days is 1 922.3 kWh a year, above the 400 kWh CAV exemption.
    expect(result.period.cav).toBeCloseTo((2.85 * 12 * 30) / 365, 6);
    expect(result.period.iec).toBeCloseTo(0.158, 6);
    expect(result.firstYear.kwh).toBeCloseTo((158 * 365) / 30, 6);
    // 250 kWh in 30 days: 200 at 6%, 50 at 23%.
    const bigger = only(run([offer("TUR")], { kwh: periodKwh(30, { simple: 250 }), options: ["simple"] }).results);
    const { energy } = offer("TUR").prices[3.45]!.simple!;
    expect(bigger.period.vatReduced).toBeCloseTo((0.1718 * 30 + 200 * energy + (2.85 * 12 * 30) / 365) * 0.06, 6);
  });

  it("applies percentage refunds as fractions, and fixed amounts that include VAT", () => {
    const repsol = offer("REPSOL_125");
    expect(repsol.refunds.powerPercent).toBe(0.02);
    const result = only(run([repsol], { kwh: typeOne, options: ["biHourly"], includeRefunds: true }).results);
    const { powerPerDay, offValley, valley } = repsol.prices[3.45]!.biHourly!;
    const energyNet = 1140 * offValley + 760 * valley;
    const expected = 0.684 / 1.23 + 0.02 * powerPerDay * 365 + 0.02 * energyNet + 1900 * 0.00002;
    expect(result.firstYear.refunds).toBeCloseTo(-expected, 6);
    expect(result.firstYear.newClientDiscount).toBe(0);
  });

  it("takes the new-client discount off the first year only, and only when asked", () => {
    const edp = offer("EDPC_14");
    const asNew = only(run([edp], { kwh: typeOne, options: ["simple"], newClient: true }).results);
    expect(asNew.firstYear.newClientDiscount).toBeCloseTo(-100 / 1.23, 6);
    expect(asNew.laterYears.newClientDiscount).toBe(0);
    // 100 EUR including VAT comes off the total.
    expect(asNew.laterYears.total - asNew.firstYear.total).toBeCloseTo(100, 1);
    const notNew = only(run([edp], { kwh: typeOne, options: ["simple"] }).results);
    expect(notNew.firstYear.total).toBe(asNew.laterYears.total);
  });

  it("adds mandatory services with their VAT", () => {
    const galp = offer("GALP_27");
    const result = only(run([galp], { kwh: periodKwh(365, { simple: 1900 }), options: ["simple"] }).results);
    expect(result.firstYear.services).toBeCloseTo(58.8 / 1.23, 6);
  });

  it("marks indexed offers as estimates and flags dual offers, which stay out unless asked for", () => {
    const priced = run([offer("AUDAX_09"), offer("TUR")], { kwh: typeOne, options: ["biHourly"] }).results;
    expect(priced.find((result) => result.offer.id === "AUDAX_09")?.estimated).toBe(true);
    expect(priced.find((result) => result.offer.id === "TUR")?.estimated).toBe(false);
    const dual = { ...offer("MEOENERGIA_02"), id: "DUAL_X", dual: true };
    expect(run([dual], { kwh: typeOne }).results).toHaveLength(0);
    const withDual = run([dual], { kwh: typeOne, includeDual: true }).results;
    expect(withDual.length).toBeGreaterThan(0);
    expect(withDual.every((result) => result.dual)).toBe(true);
  });

  it("leaves out conditioned offers unless asked for", () => {
    expect(offer("END_69").conditioned).toBe(true);
    expect(run([offer("END_69")], { kwh: typeOne, includeConditioned: false }).results).toHaveLength(0);
    expect(run([offer("END_69")], { kwh: typeOne }).results.length).toBeGreaterThan(0);
  });

  it("prices each available option, sorts by the chosen total and can keep one offer per supplier", () => {
    const offers = FIXTURE_OFFERS.filter((candidate) => !candidate.conditioned);
    const all = run(offers, { kwh: typeOne, newClient: true, includeRefunds: true }).results;
    expect(new Set(all.map((result) => result.option))).toEqual(new Set(["simple", "biHourly", "triHourly"]));
    const totals = all.map((result) => result.firstYear.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    // EDP's 100 EUR new-client discount puts it first in the first year.
    expect(all[0].offer.id).toBe("EDPC_14");

    const later = run(offers, { kwh: typeOne, newClient: true, includeRefunds: true, sortBy: "laterYears" }).results;
    const laterTotals = later.map((result) => result.laterYears.total);
    expect(laterTotals).toEqual([...laterTotals].sort((a, b) => a - b));

    const cheapest = run(offers, { kwh: typeOne, newClient: true, includeRefunds: true, cheapestPerSupplier: true }).results;
    const suppliers = cheapest.map((result) => result.offer.supplier);
    expect(new Set(suppliers).size).toBe(suppliers.length);
    for (const result of cheapest) {
      const best = all.find((candidate) => candidate.offer.supplier === result.offer.supplier);
      expect([result.offer.id, result.option]).toEqual([best?.offer.id, best?.option]);
    }
  });

  it("prices bi-hourly and tri-hourly offers on the visitor's cycle", () => {
    const daily = { biHourly: { offValley: 1140, valley: 760 }, triHourly: { peak: 300, shoulder: 840, valley: 760 } };
    const weekly = { biHourly: { offValley: 1000, valley: 900 }, triHourly: { peak: 250, shoulder: 750, valley: 900 } };
    const kwh: PeriodKwh = { days: 365, simple: { energy: 1900 }, daily, weekly };
    const onDaily = only(run([offer("TUR")], { kwh, cycle: "daily", options: ["triHourly"] }).results);
    const onWeekly = only(run([offer("TUR")], { kwh, cycle: "weekly", options: ["triHourly"] }).results);
    const { peak, shoulder, valley } = offer("TUR").prices[3.45]!.triHourly!;
    expect(onDaily.firstYear.energy).toBeCloseTo(300 * peak + 840 * shoulder + 760 * valley, 6);
    expect(onWeekly.firstYear.energy).toBeCloseTo(250 * peak + 750 * shoulder + 900 * valley, 6);
  });

  it("prices every offer in the current snapshot to a finite total", async () => {
    const { ELECTRICITY_OFFERS } = await import("./data/electricityOffers");
    const result = run(ELECTRICITY_OFFERS, { kwh: typeOne, newClient: true, includeRefunds: true, includeDual: true });
    expect(result.results.length).toBeGreaterThan(0);
    for (const { firstYear, laterYears, period } of result.results) {
      for (const bill of [firstYear, laterYears, period]) expect(Number.isFinite(bill.total)).toBe(true);
    }
    expect(result.results.some((priced) => priced.offer.regulated)).toBe(true);
  });

  it("skips offers with no price for the power or option", () => {
    expect(run([offer("TUR")], { contractedPower: 41.4, kwh: typeOne }).results).toHaveLength(0);
  });

  it("explains invalid input instead of guessing", () => {
    const bad = (input: Partial<TariffComparisonInput>) => {
      const outcome = compareElectricityOffers(FIXTURE_OFFERS, { contractedPower: 3.45, kwh: typeOne, ...DEFAULTS, ...input });
      return outcome.ok ? null : outcome.errors;
    };
    expect(bad({ contractedPower: 3 as TariffComparisonInput["contractedPower"] })).toEqual({ contractedPower: "notAllowed" });
    expect(bad({ kwh: { ...typeOne, days: 0 } })).toEqual({ days: "outOfRange" });
    expect(bad({ kwh: { ...typeOne, days: Number.NaN } })).toEqual({ days: "required" });
    expect(bad({ kwh: { ...typeOne, days: 800 } })).toEqual({ days: "outOfRange" });
    expect(bad({ kwh: { ...typeOne, simple: { energy: -1 } } })).toEqual({ consumption: "negative" });
    expect(bad({ kwh: { ...typeOne, simple: { energy: Number.NaN } } })).toEqual({ consumption: "required" });
    // Only the options asked for are checked.
    expect(bad({ kwh: { ...typeOne, simple: { energy: Number.NaN } }, options: ["biHourly"] })).toBeNull();
  });
});
