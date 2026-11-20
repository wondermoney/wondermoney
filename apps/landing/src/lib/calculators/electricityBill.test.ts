import { describe, expect, it } from "vitest";
import {
  BILL_DAYS,
  ELECTRICITY_BILL_EXAMPLE,
  ELECTRICITY_PRICES,
  ELECTRICITY_PRICES_SOURCE,
  ERSE_TARIFFS,
  breakEvenOffPeakPercent,
  computeElectricityBill,
  electricityIndexSeries,
  type ElectricityBillInput,
} from "./electricityBill";

const run = (overrides: Partial<ElectricityBillInput> = {}) => {
  const outcome = computeElectricityBill({ ...ELECTRICITY_BILL_EXAMPLE, ...overrides });
  if (!outcome.ok) throw new Error(`unexpected errors ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
};

describe("ERSE regulated tariff data (Diretiva n.º 4/2026, from 1 October 2026)", () => {
  it("holds the published prices", () => {
    expect(ERSE_TARIFFS.powerPerDay).toEqual({ 3.45: 0.1917, 4.6: 0.2499, 5.75: 0.3079, 6.9: 0.3659 });
    expect(ERSE_TARIFFS.energyPerKwh).toEqual({ simple: 0.1711, biPeak: 0.2045, biOffPeak: 0.1143 });
    expect(ERSE_TARIFFS.cavPerMonth).toBe(2.85);
    expect(ERSE_TARIFFS.iecPerKwh).toBe(0.001);
    expect(ERSE_TARIFFS.effectiveFrom).toBe("2026-10-01");
  });
});

describe("computeElectricityBill", () => {
  it("works out the worked example line by line (3.45 kVA, 158 kWh, simple)", () => {
    const r = run();
    expect(BILL_DAYS).toBe(30);
    // Código do IVA, Lista I verba 2.33 (Decreto-Lei n.º 60/2019): 6% only on the network-access
    // tariff's fixed term (0.1718 EUR/day at 3.45 kVA), 23% on the rest of the 0.1917 EUR/day.
    expect(r.breakdown.powerNetwork.net).toBeCloseTo(0.1718 * 30, 6);
    expect(r.breakdown.powerNetwork.vatRate).toBe(0.06);
    expect(r.breakdown.power.net).toBeCloseTo((0.1917 - 0.1718) * 30, 6);
    expect(r.breakdown.power.vatRate).toBe(0.23);
    expect(r.breakdown.energyReduced.net).toBeCloseTo(27.0338, 6);
    expect(r.breakdown.energyStandard.net).toBeCloseTo(0, 6);
    expect(r.breakdown.cav.net).toBe(2.85);
    expect(r.breakdown.iec.net).toBeCloseTo(0.158, 6);
    expect(r.subtotal).toBe(35.79);
    expect(r.vat).toBe(2.28);
    expect(r.total).toBe(38.07);
    expect(r.yearly).toBe(456.82);
    expect(r.effectivePerKwh).toBeCloseTo(0.2409, 4);
  });

  it("lands close to ERSE's own published example for the same case", () => {
    // ERSE, "Tarifa Social na Eletricidade em 2026": 3.45 kVA, 1 900 kWh a year, same tariffs,
    // monthly bill 38.15 EUR. ERSE does not itemise the DGEG fee here, which we leave out.
    const r = run({ consumption: 1900, period: "year" });
    expect(Math.abs(r.total - 38.15)).toBeLessThan(0.25);
  });

  it("taxes the power term at 23% above 3.45 kVA, and keeps 6% on the first 200 kWh up to 6.9 kVA", () => {
    const r = run({ contractedPower: 4.6, consumption: 250 });
    expect(r.breakdown.powerNetwork.net).toBe(0);
    expect(r.breakdown.power.net).toBeCloseTo(0.2499 * 30, 6);
    expect(r.breakdown.power.vatRate).toBe(0.23);
    expect(r.reducedKwh).toBe(200);
    expect(r.breakdown.energyReduced.net).toBeCloseTo(200 * 0.1711, 6);
    expect(r.breakdown.energyStandard.net).toBeCloseTo(50 * 0.1711, 6);
    const expected =
      (0.2499 * 30 + 250 * 0.001) * 1.23 + 2.85 * 1.06 + 200 * 0.1711 * 1.06 + 50 * 0.1711 * 1.23;
    expect(r.total).toBeCloseTo(expected, 2);
  });

  it("extends the reduced rate to 300 kWh for households of five or more", () => {
    const r = run({ contractedPower: 6.9, consumption: 280, largeFamily: true });
    expect(r.reducedKwh).toBe(280);
    expect(r.breakdown.energyStandard.net).toBeCloseTo(0, 6);
    expect(run({ contractedPower: 6.9, consumption: 280 }).reducedKwh).toBe(200);
  });

  it("prices bi-hourly by the share in the off-peak hours", () => {
    const r = run({ option: "biHourly", offPeakPercent: 40, consumption: 100 });
    expect(r.breakdown.energyReduced.net).toBeCloseTo(60 * 0.2045 + 40 * 0.1143, 6);
    const allValley = run({ option: "biHourly", offPeakPercent: 100, consumption: 100 });
    expect(allValley.breakdown.energyReduced.net).toBeCloseTo(100 * 0.1143, 6);
  });

  it("finds the break-even off-peak share and prices both options the same there", () => {
    const share = breakEvenOffPeakPercent();
    expect(share).toBeCloseTo(37.03, 1);
    const simple = run({ consumption: 500, contractedPower: 6.9 });
    const bi = run({ consumption: 500, contractedPower: 6.9, option: "biHourly", offPeakPercent: share });
    expect(bi.total).toBeCloseTo(simple.total, 1);
    expect(simple.alternative?.option).toBe("biHourly");
  });

  it("reports the other option so bi-hourly can be compared with simple", () => {
    const cheaperBi = run({ option: "biHourly", offPeakPercent: 60, consumption: 300 });
    expect(cheaperBi.alternative?.option).toBe("simple");
    expect(cheaperBi.total).toBeLessThan(cheaperBi.alternative!.total);
    const dearerBi = run({ option: "biHourly", offPeakPercent: 10, consumption: 300 });
    expect(dearerBi.total).toBeGreaterThan(dearerBi.alternative!.total);
  });

  it("treats an annual figure as twelve equal months", () => {
    expect(run({ consumption: 1896, period: "year" })).toEqual(run({ consumption: 158 }));
  });

  it("handles zero consumption: only the power term and the audiovisual contribution", () => {
    // 0.1718 * 30 * 1.06 + (0.1917 - 0.1718) * 30 * 1.23 + 2.85 * 1.06
    const r = run({ consumption: 0 });
    expect(r.total).toBe(9.22);
    expect(r.effectivePerKwh).toBeNull();
    expect(r.breakdown.energyReduced.net).toBe(0);
  });

  it("rounds an exact half cent up", () => {
    // 6.9 kVA, 1 000 kWh, bi-hourly with 1% off-peak, large family: the subtotal is 218.425 EUR
    // exactly (power 10.977, energy 300 x 0.2045 x 0.99 + 300 x 0.1143 x 0.01 at 6% and the rest at
    // 23%, CAV 2.85, IEC 1), which floating point can land a hair below.
    const r = run({ contractedPower: 6.9, consumption: 1000, option: "biHourly", offPeakPercent: 1, largeFamily: true });
    expect(r.subtotal).toBe(218.43);
  });

  it("explains every invalid input instead of guessing", () => {
    const bad = (overrides: Partial<ElectricityBillInput>) => {
      const outcome = computeElectricityBill({ ...ELECTRICITY_BILL_EXAMPLE, ...overrides });
      return outcome.ok ? null : outcome.errors;
    };
    expect(bad({ contractedPower: 10.35 })).toEqual({ contractedPower: "notAllowed" });
    expect(bad({ contractedPower: Number.NaN })).toEqual({ contractedPower: "notAllowed" });
    expect(bad({ consumption: Number.NaN })).toEqual({ consumption: "required" });
    expect(bad({ consumption: -1 })).toEqual({ consumption: "negative" });
    expect(bad({ consumption: 20_001 })).toEqual({ consumption: "tooLarge" });
    expect(bad({ consumption: 240_001, period: "year" })).toEqual({ consumption: "tooLarge" });
    expect(bad({ option: "biHourly", offPeakPercent: 101 })).toEqual({ offPeakPercent: "percentRange" });
    expect(bad({ option: "biHourly", offPeakPercent: -1 })).toEqual({ offPeakPercent: "percentRange" });
    expect(bad({ option: "biHourly", offPeakPercent: Number.NaN })).toEqual({ offPeakPercent: "required" });
    // The off-peak share is ignored on the simple tariff.
    expect(bad({ option: "simple", offPeakPercent: 500 })).toBeNull();
  });
});

describe("electricity price index series", () => {
  it("covers both prices for every half-year, oldest first, with the gap to the EU", () => {
    const series = electricityIndexSeries();
    expect(series.length).toBe(ELECTRICITY_PRICES.length);
    expect(series[0].period).toBe(ELECTRICITY_PRICES_SOURCE.firstPeriod);
    expect(series.at(-1)?.period).toBe(ELECTRICITY_PRICES_SOURCE.lastPeriod);
    const periods = series.map((point) => point.period);
    expect([...periods].sort()).toEqual(periods);
    for (const point of series) {
      expect(point.portugal).toBeGreaterThan(0);
      expect(point.eu).toBeGreaterThan(0);
      expect(point.gapPercent).toBeCloseTo((point.portugal / point.eu - 1) * 100, 10);
    }
    expect(electricityIndexSeries([["2024-S1", 0.2, 0.25]])[0]).toMatchObject({ label: "2024 S1" });
    expect(electricityIndexSeries([["2024-S1", 0.2, 0.25]])[0].gapPercent).toBeCloseTo(-20, 10);
  });
});
