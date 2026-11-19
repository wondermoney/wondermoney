import { describe, expect, it } from "vitest";
import { deriveInflation, deriveYearEndReturns, mergeYears } from "../../../scripts/build-sp500-history.mjs";
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
    expect(result.years).toHaveLength(98);
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
    for (const source of [SP500_HISTORY_SOURCE.returns, SP500_HISTORY_SOURCE.inflation]) {
      expect(source.downloadedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(SP500_HISTORY_SOURCE.returns.name).toContain("Damodaran");
    expect(SP500_HISTORY_SOURCE.inflation.name).toContain("Shiller");
    expect(SP500_HISTORY_SOURCE.firstYear).toBe(1928);
  });

  it("never has dividends take away from the price return, or implausible values", () => {
    for (const [year, price, total, inflation] of SP500_HISTORY) {
      expect(total, String(year)).toBeGreaterThan(price - 0.01);
      expect(total, String(year)).toBeGreaterThan(-100);
      expect(total, String(year)).toBeLessThan(100);
      expect(Math.abs(inflation), String(year)).toBeLessThan(25);
    }
  });

  // Damodaran's own published total return column ("Returns by year", histretSP.xls, rounded to
  // two decimals), not the source of the data: the script derives the returns from year-end
  // levels and dividends and refuses to run when any year is more than 0.1 point from it.
  it("matches the published annual total returns within half a point", () => {
    const published: Array<[year: number, total: number]> = [
      [1995, 37.2],
      [2000, -9.03],
      [2008, -36.55],
      [2013, 32.15],
      [2019, 31.21],
      [2021, 28.47],
      [2022, -18.04],
      [2023, 26.06],
    ];
    for (const [year, total] of published) {
      const row = SP500_HISTORY.find(([y]) => y === year);
      expect(Math.abs((row?.[2] ?? NaN) - total), String(year)).toBeLessThan(0.5);
    }
  });

  it("gives a long-run total CAGR close to the published 10.0 percent since 1928", () => {
    const outcome = computeSp500History(
      { ...base, startYear: 1928, endYear: SP500_HISTORY_SOURCE.lastYear },
      SP500_HISTORY,
    );
    if (!outcome.ok) throw new Error("range must be valid");
    expect(outcome.result.cagrPct).toBeGreaterThan(9.9);
    expect(outcome.result.cagrPct).toBeLessThan(10.2);
  });
});

describe("deriveYearEndReturns", () => {
  const rows = [
    { year: 2000, level: 100, dividends: 2 },
    { year: 2001, level: 110, dividends: 3 },
    { year: 2002, level: 88, dividends: 3.3 },
  ];

  it("computes price and total return from year-end levels and dividends", () => {
    expect(deriveYearEndReturns(rows)).toEqual([
      { year: 2001, price: 10, total: 13 },
      { year: 2002, price: -20, total: -17 },
    ]);
  });

  it("checks the total against the published return and refuses a gap or missing data", () => {
    const published = rows.map((row, i) => ({ ...row, published: [0, 0.13, -0.17][i] }));
    expect(deriveYearEndReturns(published)).toHaveLength(2);
    published[1].published = 0.135;
    expect(() => deriveYearEndReturns(published)).toThrow(/more than 0.1 points/);
    expect(() => deriveYearEndReturns([rows[0], rows[2]])).toThrow(/Gap/);
    expect(() => deriveYearEndReturns([rows[0], { year: 2001, level: 110 }])).toThrow(/Missing/);
  });
});

describe("deriveInflation", () => {
  const month = (year: number, m: number, cpi: number) => ({ date: year + m / 100, cpi });

  it("compares December with the previous December, reading 2008.1 as October", () => {
    const inflation = deriveInflation([
      month(2000, 12, 100),
      month(2001, 10, 90),
      { date: 2001.1, cpi: 90 },
      month(2001, 12, 103),
      month(2002, 6, 104),
    ]);
    expect(inflation.get(2001)).toBe(3);
    expect(inflation.has(2002)).toBe(false);
  });

  it("is merged by year and refuses a year without inflation", () => {
    const returns = [{ year: 2001, price: 10, total: 13 }];
    expect(mergeYears(returns, new Map([[2001, 3]]))).toEqual([{ year: 2001, price: 10, total: 13, inflation: 3 }]);
    expect(() => mergeYears(returns, new Map())).toThrow(/No CPI/);
  });
});
