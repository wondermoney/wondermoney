import { describe, expect, it } from "vitest";
import { deriveAnnualReturns, type MonthlyRow } from "../../../scripts/build-sp500-history.mjs";
import {
  SP500_HISTORY,
  SP500_HISTORY_EXAMPLE,
  SP500_HISTORY_LIMITS,
  SP500_HISTORY_SOURCE,
  computeSp500History,
  type Sp500HistoryInput,
} from "./sp500History";
import type { Sp500HistoryRow } from "./data/sp500History";

const base: Sp500HistoryInput = {
  startYear: 2001,
  endYear: 2003,
  initial: 1000,
  annualContribution: 0,
  reinvestDividends: true,
  inflationAdjusted: false,
};
// year, price %, total %, inflation %
const mini: readonly Sp500HistoryRow[] = [
  [2001, 10, 12, 2],
  [2002, -20, -18, 5],
  [2003, 30, 33, 0],
];

function ok(input: Sp500HistoryInput, history = mini) {
  const outcome = computeSp500History(input, history);
  if (!outcome.ok) throw new Error(`expected a result, got ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
}

describe("computeSp500History", () => {
  it("compounds the total returns year by year", () => {
    const result = ok(base);
    expect(result.years.map((row) => Math.round(row.endValue * 100) / 100)).toEqual([1120, 918.4, 1221.47]);
    expect(result.finalValue).toBeCloseTo(1000 * 1.12 * 0.82 * 1.33, 8);
    expect(result.contributed).toBe(1000);
    expect(result.gain).toBeCloseTo(result.finalValue - 1000, 8);
  });

  it("uses the price return when dividends are not reinvested", () => {
    expect(ok({ ...base, reinvestDividends: false }).finalValue).toBeCloseTo(1000 * 1.1 * 0.8 * 1.3, 8);
  });

  it("reports the CAGR as the geometric mean of the yearly returns, best and worst year", () => {
    const result = ok(base);
    expect(result.cagrPct).toBeCloseTo((Math.pow(1.12 * 0.82 * 1.33, 1 / 3) - 1) * 100, 8);
    expect(result.best).toEqual({ year: 2003, returnPct: expect.closeTo(33, 8) });
    expect(result.worst).toEqual({ year: 2002, returnPct: expect.closeTo(-18, 8) });
  });

  it("adds each contribution on 1 January, the first year included", () => {
    const result = ok({ ...base, initial: 0, annualContribution: 100 });
    expect(result.years[0].endValue).toBeCloseTo(112, 8);
    expect(result.years[1].endValue).toBeCloseTo((112 + 100) * 0.82, 8);
    expect(result.contributed).toBe(300);
    expect(result.finalValue).toBeCloseTo(((112 + 100) * 0.82 + 100) * 1.33, 8);
  });

  it("restates everything in start-year money when inflation adjusted", () => {
    const result = ok({ ...base, annualContribution: 100, inflationAdjusted: true });
    // Prices rise 2% in 2001 and 5% in 2002: contributions of 100 on 1 January 2002 and 2003
    // are worth 100 / 1.02 and 100 / (1.02 * 1.05) in 2001 money.
    expect(result.contributed).toBeCloseTo(1100 + 100 / 1.02 + 100 / (1.02 * 1.05), 8);
    expect(result.years[0].returnPct).toBeCloseTo((1.12 / 1.02 - 1) * 100, 8);
    const nominal = ok({ ...base, annualContribution: 100 });
    expect(result.finalValue).toBeCloseTo(nominal.finalValue / (1.02 * 1.05 * 1.0), 8);
    expect(result.worst.year).toBe(2002);
    expect(result.cagrPct).toBeCloseTo(
      (Math.pow((1.12 / 1.02) * (0.82 / 1.05) * (1.33 / 1), 1 / 3) - 1) * 100,
      8,
    );
  });

  it("handles a single year", () => {
    const result = ok({ ...base, startYear: 2002, endYear: 2002 });
    expect(result.years).toHaveLength(1);
    expect(result.finalValue).toBeCloseTo(820, 8);
    expect(result.cagrPct).toBeCloseTo(-18, 8);
    expect(result.best.year).toBe(2002);
    expect(result.worst.year).toBe(2002);
  });

  it("never shows a stale result for invalid input", () => {
    const errors = (input: Partial<Sp500HistoryInput>) => {
      const outcome = computeSp500History({ ...base, ...input }, mini);
      return outcome.ok ? null : outcome.errors;
    };
    expect(errors({ startYear: 2003, endYear: 2001 })).toEqual({ endYear: "beforeStart" });
    expect(errors({ startYear: NaN })).toEqual({ startYear: "required" });
    expect(errors({ startYear: 2001.5 })).toEqual({ startYear: "whole" });
    expect(errors({ endYear: SP500_HISTORY_LIMITS.lastYear + 1 })).toEqual({ endYear: "outOfRange" });
    expect(errors({ startYear: SP500_HISTORY_LIMITS.firstYear - 1 })).toEqual({ startYear: "outOfRange" });
    expect(errors({ initial: -1 })).toEqual({ initial: "tooSmall" });
    expect(errors({ annualContribution: NaN })).toEqual({ annualContribution: "required" });
    expect(errors({ initial: 0, annualContribution: 0 })).toEqual({ initial: "nothingInvested" });
    expect(errors({ initial: SP500_HISTORY_LIMITS.maxAmount + 1 })).toEqual({ initial: "tooLarge" });
  });

  it("accepts the largest amounts over the whole history and stays finite", () => {
    const result = ok(
      {
        ...base,
        startYear: SP500_HISTORY_LIMITS.firstYear,
        endYear: SP500_HISTORY_LIMITS.lastYear,
        initial: SP500_HISTORY_LIMITS.maxAmount,
        annualContribution: SP500_HISTORY_LIMITS.maxAmount,
      },
      SP500_HISTORY,
    );
    expect(Number.isFinite(result.finalValue)).toBe(true);
    expect(result.years).toHaveLength(154);
  });

  it("answers the example from the committed data", () => {
    const result = ok(SP500_HISTORY_EXAMPLE, SP500_HISTORY);
    expect(result.years).toHaveLength(25);
    expect(result.worst.year).toBe(2008);
    expect(result.finalValue).toBeGreaterThan(SP500_HISTORY_EXAMPLE.initial);
  });
});

describe("committed Shiller data", () => {
  it("covers every complete year with no gaps and a dated source", () => {
    const years = SP500_HISTORY.map(([year]) => year);
    expect(years[0]).toBe(SP500_HISTORY_SOURCE.firstYear);
    expect(years.at(-1)).toBe(SP500_HISTORY_SOURCE.lastYear);
    expect(years).toEqual(Array.from({ length: years.length }, (_, i) => years[0] + i));
    expect(SP500_HISTORY_SOURCE.downloadedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SP500_HISTORY_SOURCE.name).toContain("Shiller");
  });

  it("never has dividends take away from the price return, or implausible values", () => {
    for (const [year, price, total, inflation] of SP500_HISTORY) {
      expect(total, String(year)).toBeGreaterThan(price - 0.01);
      expect(total, String(year)).toBeGreaterThan(-100);
      expect(total, String(year)).toBeLessThan(100);
      expect(Math.abs(inflation), String(year)).toBeLessThan(25);
    }
  });

  // Published calendar-year total returns of the S&P 500 (year-end to year-end closes). Shiller's
  // monthly prices are averages of daily closes, so single years differ by a few points; the
  // tolerance reflects that, and long ranges converge because only the two end points differ.
  it("matches widely published annual total returns within the method difference", () => {
    const published: Array<[year: number, total: number]> = [
      [1995, 37.58],
      [2000, -9.1],
      [2008, -37.0],
      [2013, 32.39],
      [2019, 31.49],
      [2020, 18.4],
      [2021, 28.71],
      [2022, -18.11],
      [2023, 26.29],
    ];
    for (const [year, total] of published) {
      const row = SP500_HISTORY.find(([y]) => y === year);
      expect(Math.abs((row?.[2] ?? NaN) - total), String(year)).toBeLessThan(6);
    }
  });

  it("gives a long-run total CAGR close to the published 10 percent since 1928", () => {
    const outcome = computeSp500History(
      { ...base, startYear: 1928, endYear: SP500_HISTORY_SOURCE.lastYear },
      SP500_HISTORY,
    );
    if (!outcome.ok) throw new Error("range must be valid");
    expect(outcome.result.cagrPct).toBeGreaterThan(9.3);
    expect(outcome.result.cagrPct).toBeLessThan(10.6);
  });
});

describe("deriveAnnualReturns", () => {
  const month = (year: number, m: number, price: number, dividend: number, cpi: number): MonthlyRow => ({
    date: year + m / 100,
    price,
    dividend,
    cpi,
  });
  const flatYear = (year: number, price: number, cpi: number) =>
    Array.from({ length: 12 }, (_, i) => month(year, i + 1, price, 12, cpi));

  it("chains monthly total returns and compares December with the previous December", () => {
    const rows = [...flatYear(2000, 100, 100), ...flatYear(2001, 110, 103)];
    const [record] = deriveAnnualReturns(rows);
    expect(record.year).toBe(2001);
    expect(record.price).toBe(10);
    expect(record.inflation).toBe(3);
    // Jan 2001: (110 + 12/12) / 100; the other eleven months: (110 + 1) / 110.
    const expected = ((111 / 100) * Math.pow(111 / 110, 11) - 1) * 100;
    expect(record.total).toBeCloseTo(expected, 2);
  });

  it("reads Shiller's year.month floats, where 2008.1 is October", () => {
    const rows = [...flatYear(2007, 100, 100), ...flatYear(2008, 100, 100)];
    rows[12 + 9] = { ...rows[12 + 9], date: 2008.1, price: 50 };
    rows[12 + 10] = { ...rows[12 + 10], price: 60 };
    const [record] = deriveAnnualReturns(rows);
    expect(record.price).toBe(0);
    // The October crash is in the chain: the total return is not the flat-price one.
    expect(Math.abs(record.total - 12)).toBeGreaterThan(1);
  });

  it("skips partial years and refuses a missing month or dividend", () => {
    const partial = [...flatYear(2000, 100, 100), ...flatYear(2001, 100, 100).slice(0, 9)];
    expect(deriveAnnualReturns(partial)).toEqual([]);
    const gap = [...flatYear(2000, 100, 100), ...flatYear(2001, 100, 100)];
    gap.splice(14, 1);
    expect(() => deriveAnnualReturns(gap)).toThrow(/Gap/);
    const noDividend = [...flatYear(2000, 100, 100), ...flatYear(2001, 100, 100)];
    noDividend[15] = { ...noDividend[15], dividend: undefined };
    expect(() => deriveAnnualReturns(noDividend)).toThrow(/Missing/);
  });
});
