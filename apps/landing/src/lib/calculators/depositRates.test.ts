import { describe, expect, it } from "vitest";
import { buildRows, parseCsv, renderModule } from "../../../scripts/build-deposit-rates.mjs";
import {
  DEPOSIT_RATES,
  DEPOSIT_RATES_EXAMPLE,
  DEPOSIT_RATES_SOURCE,
  bucketForTerm,
  computeDepositBenchmark,
  latestRates,
  latestYearSummary,
  portugalInflation,
  realRate,
  yearSummaries,
} from "./depositRates";
import type { DepositRateRow } from "./data/depositRates";

// Month, then Portugal all / up to 1y / 1-2y / over 2y, then the euro area in the same order.
const mini: readonly DepositRateRow[] = [
  ["2025-12", 2, 1.5, 2.5, null, 3, 2.5, 3.5, 4],
];

describe("the generated deposit-rate data", () => {
  it("has one row per month, with no gaps, from the first to the last month", () => {
    expect(DEPOSIT_RATES[0][0]).toBe(DEPOSIT_RATES_SOURCE.firstMonth);
    expect(DEPOSIT_RATES.at(-1)?.[0]).toBe(DEPOSIT_RATES_SOURCE.lastMonth);
    let expected: string = DEPOSIT_RATES_SOURCE.firstMonth;
    for (const row of DEPOSIT_RATES) {
      expect(row[0]).toBe(expected);
      const [year, month] = expected.split("-").map(Number);
      expected = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
    }
  });

  it("has a plausible total rate for both areas every month and null or plausible buckets", () => {
    for (const row of DEPOSIT_RATES) {
      for (const total of [row[1], row[5]]) expect(total).toBeGreaterThanOrEqual(0);
      for (const value of row.slice(1)) {
        if (value !== null) expect(value).toBeLessThan(10);
      }
    }
  });

  it("states where and when the data came from", () => {
    expect(DEPOSIT_RATES_SOURCE.seriesPortugal).toBe("MIR.M.PT.B.L22.{m}.R.A.2250.EUR.N");
    expect(DEPOSIT_RATES_SOURCE.seriesEuroArea).toBe("MIR.M.U2.B.L22.{m}.R.A.2250.EUR.N");
    expect(DEPOSIT_RATES_SOURCE.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEPOSIT_RATES_SOURCE.licenceUrl).toContain("ecb.europa.eu");
  });
});

describe("rates and inflation", () => {
  it("reads the latest month, with the provisional flag from the source", () => {
    const latest = latestRates();
    expect(latest.month).toBe(DEPOSIT_RATES_SOURCE.lastMonth);
    expect(latest.provisional).toBe(DEPOSIT_RATES_SOURCE.provisionalMonths.includes(latest.month));
    expect(latestRates(mini).pt.over2y).toBeNull();
    expect(latestRates(mini).ea.all).toBe(3);
  });

  it("derives inflation from the annual CPI, and none when a year is missing", () => {
    expect(portugalInflation(2025)).toBeGreaterThan(0);
    expect(portugalInflation(1900)).toBeNull();
    expect(portugalInflation(2026)).toBeNull();
  });

  it("works the real rate as a ratio", () => {
    expect(realRate(3, 3)).toBeCloseTo(0, 10);
    expect(realRate(2, 4)).toBeCloseTo(-1.9231, 4);
    expect(realRate(0, 0)).toBe(0);
  });

  it("summarises complete years only, with the after-tax real rate", () => {
    const years = yearSummaries();
    expect(years[0].year).toBe(2003);
    // 2026 has no December yet and no CPI.
    expect(years.map((row) => row.year)).not.toContain(2026);
    expect(latestYearSummary().year).toBe(2025);
    const sample = years.find((row) => row.year === 2025)!;
    const months = DEPOSIT_RATES.filter((row) => row[0].startsWith("2025-"));
    expect(months).toHaveLength(12);
    const mean = months.reduce((sum, row) => sum + row[1], 0) / 12;
    expect(sample.pt).toBeCloseTo(mean, 2);
    expect(sample.realNet).toBeCloseTo(realRate(mean * 0.72, sample.inflation), 1);
    expect(sample.realNet).toBeLessThan(sample.realGross);
  });

  it("skips a year with fewer than twelve months", () => {
    expect(yearSummaries(mini)).toEqual([]);
  });
});

describe("the deposit benchmark", () => {
  it("maps a term to its maturity group", () => {
    expect(bucketForTerm(1)).toBe("upTo1y");
    expect(bucketForTerm(12)).toBe("upTo1y");
    expect(bucketForTerm(13)).toBe("1to2y");
    expect(bucketForTerm(24)).toBe("1to2y");
    expect(bucketForTerm(25)).toBe("over2y");
  });

  it("takes 28% IRS off the interest and compares it with inflation", () => {
    const outcome = computeDepositBenchmark({ amount: 10_000, termMonths: 12, inflation: 2 }, mini);
    if (!outcome.ok) throw new Error("expected a result");
    const { result } = outcome;
    expect(result.bucket).toBe("upTo1y");
    expect(result.ratePct).toBe(1.5);
    expect(result.deposit.grossInterest).toBe(150);
    expect(result.deposit.tax).toBe(42);
    expect(result.deposit.netInterest).toBe(108);
    expect(result.inflationCost).toBe(200);
    expect(result.realGain).toBe(-92);
    expect(result.netYieldPct).toBeCloseTo(1.08, 6);
    expect(result.realNetYieldPct).toBeCloseTo(realRate(1.08, 2), 6);
  });

  it("falls back to the all-maturities average when a group has no new business", () => {
    const outcome = computeDepositBenchmark({ amount: 1000, termMonths: 36, inflation: 0 }, mini);
    if (!outcome.ok) throw new Error("expected a result");
    expect(outcome.result.fellBack).toBe(true);
    expect(outcome.result.bucket).toBe("all");
    expect(outcome.result.ratePct).toBe(2);
    expect(outcome.result.inflationCost).toBe(0);
  });

  it("scales inflation over the term, and handles deflation", () => {
    const longer = computeDepositBenchmark({ amount: 10_000, termMonths: 24, inflation: 2 }, mini);
    if (!longer.ok) throw new Error("expected a result");
    expect(longer.result.bucket).toBe("1to2y");
    expect(longer.result.inflationCost).toBe(404);
    const deflation = computeDepositBenchmark({ amount: 10_000, termMonths: 12, inflation: -1 }, mini);
    if (!deflation.ok) throw new Error("expected a result");
    expect(deflation.result.inflationCost).toBe(-100);
    expect(deflation.result.realGain).toBe(208);
  });

  it("opens with a valid example", () => {
    expect(computeDepositBenchmark({ ...DEPOSIT_RATES_EXAMPLE }).ok).toBe(true);
  });

  it("reports each invalid field without a result", () => {
    const bad = (input: Parameters<typeof computeDepositBenchmark>[0]) => {
      const outcome = computeDepositBenchmark(input);
      return outcome.ok ? null : outcome.errors;
    };
    const valid = { amount: 1000, termMonths: 12, inflation: 2 };
    expect(bad({ ...valid, amount: NaN })).toEqual({ amount: "required" });
    expect(bad({ ...valid, amount: 0 })).toEqual({ amount: "required" });
    expect(bad({ ...valid, amount: -5 })).toEqual({ amount: "negative" });
    expect(bad({ ...valid, amount: 1e12 })).toEqual({ amount: "tooLarge" });
    expect(bad({ ...valid, termMonths: NaN })).toEqual({ termMonths: "required" });
    expect(bad({ ...valid, termMonths: 0 })).toEqual({ termMonths: "required" });
    expect(bad({ ...valid, termMonths: 121 })).toEqual({ termMonths: "tooLarge" });
    expect(bad({ ...valid, termMonths: 6.5 })).toEqual({ termMonths: "notWhole" });
    expect(bad({ ...valid, inflation: NaN })).toEqual({ inflation: "required" });
    expect(bad({ ...valid, inflation: 80 })).toEqual({ inflation: "outOfRange" });
    expect(bad({ amount: NaN, termMonths: NaN, inflation: NaN })).toEqual({
      amount: "required",
      termMonths: "required",
      inflation: "required",
    });
  });
});

describe("the refresh script", () => {
  const header = "KEY,REF_AREA,MATURITY_NOT_IRATE,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE";
  const line = (area: string, maturity: string, month: string, value: string, status = "A") =>
    `K,${area},${maturity},${month},${value},${status},"Title, with comma"`;
  const full = (month: string, skip: string[] = []) =>
    ["PT", "U2"].flatMap((area) =>
      ["A", "F", "G", "H"]
        .filter((maturity) => !skip.includes(`${area}${maturity}`))
        .map((maturity) => line(area, maturity, month, "1.5")),
    );
  const records = (lines: string[]) => parseCsv([header, ...lines].join("\n")) as unknown as Parameters<typeof buildRows>[0];

  it("reads quoted CSV fields", () => {
    expect(parseCsv(`${header}\n${line("PT", "A", "2003-01", "2.38")}`)[0]).toMatchObject({
      REF_AREA: "PT",
      OBS_VALUE: "2.38",
      TITLE: "Title, with comma",
    });
  });

  it("builds rows with nulls for empty maturity buckets", () => {
    const built = buildRows(records([...full("2003-01"), ...full("2003-02", ["PTG"])]));
    expect(built.months).toHaveLength(2);
    expect(built.months[0].values).toEqual([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
    expect(built.months[1].values[2]).toBeNull();
  });

  it("refuses a gap, a missing total or an implausible rate", () => {
    expect(() => buildRows(records([...full("2003-01"), ...full("2003-03")]))).toThrow(/Gap/);
    expect(() => buildRows(records(full("2003-01", ["U2A"])))).toThrow(/Missing U2 total/);
    expect(() => buildRows(records([...full("2003-01").slice(1), line("PT", "A", "2003-01", "99")]))).toThrow(
      /Implausible/,
    );
    expect(() => buildRows(records(full("2004-01")))).toThrow(/starts in/);
  });

  it("flags only recent provisional months and renders a module", () => {
    const rows = [...full("2003-01"), ...full("2003-02")].map((text) => text);
    const provisional = rows.map((text, index) => (index === rows.length - 1 ? text.replace(",A,", ",P,") : text));
    const built = buildRows(records(provisional));
    expect(built.provisional).toEqual(["2003-02"]);
    const module = renderModule(built, "2026-01-01");
    expect(module).toContain('retrievedOn: "2026-01-01"');
    expect(module).toContain('["2003-02", 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5],');
    expect(module).toContain('provisionalMonths: ["2003-02"]');
    const gap = renderModule(buildRows(records([...full("2003-01", ["PTG"])])), "2026-01-01");
    expect(gap).toContain('["2003-01", 1.5, 1.5, null, 1.5, 1.5, 1.5, 1.5, 1.5],');
  });
});
