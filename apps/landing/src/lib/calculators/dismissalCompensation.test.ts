import { describe, expect, it } from "vitest";
import {
  DISMISSAL_EXAMPLE, FIXED_TERM_MAX_YEARS, LEI_93_2019_IN_FORCE, RMMG_2026_CENTS, checkFixedTermDuration,
  computeDismissalCompensation, splitPayout, validateDismissal, type DismissalCompensationInput, type FixedTermKind,
} from "./dismissalCompensation";

const base = (overrides: Partial<DismissalCompensationInput>): DismissalCompensationInput => ({
  contractType: "permanent", fixedTermKind: "certain", baseMonthly: 3000, seniorityPay: 0, startDate: "2020-01-01", endDate: "2026-12-31", ...overrides,
});
const run = (overrides: Partial<DismissalCompensationInput>) => {
  const outcome = computeDismissalCompensation(base(overrides), "2026-11-19");
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return outcome.result;
};

const byKey = (result: ReturnType<typeof run>) => Object.fromEntries(result.lines.map((line) => [line.key, line]));

describe("dismissal compensation, contracts from 1 October 2013", () => {
  it("pays 12 days up to 30 April 2023 and 14 days from 1 May 2023 (art. 366(1), Lei 13/2023)", () => {
    // 2020-01-01 to 2026-12-31 is exactly 7 years; 100 euros a day (3000 / 30). 3 years and 120 of 365 days are before May 2023.
    const result = run({});
    expect(result.regime).toBe("from2013");
    expect(result.seniorityYears).toBeCloseTo(7, 10);
    expect(result.lines.map((line) => line.key)).toEqual(["twelveDays", "fourteenDays"]);
    const lines = byKey(result);
    expect(lines.twelveDays.years).toBeCloseTo(3 + 120 / 365, 2);
    expect(lines.fourteenDays.years).toBeCloseTo(7 - lines.twelveDays.years, 10);
    expect(lines.twelveDays.amountCents).toBe(Math.round(lines.twelveDays.years * 12 * 10_000));
    expect(lines.fourteenDays.amountCents).toBe(Math.round(lines.fourteenDays.years * 14 * 10_000));
    expect(result.compensationCents).toBe(lines.twelveDays.amountCents + lines.fourteenDays.amountCents);
    expect(result.caps).toEqual({ monthlyBase: false, total: false, earlyPartExceedsCap: false });
  });

  it("pays 14 days for every year of a contract that started after 1 May 2023", () => {
    // 2023-06-01 to 2026-05-31 is exactly 3 years.
    const result = run({ startDate: "2023-06-01", endDate: "2026-05-31" });
    expect(result.lines.map((line) => line.key)).toEqual(["fourteenDays"]);
    expect(result.compensationCents).toBe(3 * 14 * 10_000);
  });

  it("counts a fraction of a year proportionally", () => {
    // 2024-01-01 to 2026-06-30 is 2 years and 181 of 365 days, all after 1 May 2023.
    const result = run({ startDate: "2024-01-01", endDate: "2026-06-30" });
    expect(result.seniorityYears).toBeCloseTo(2 + 181 / 365, 10);
    expect(result.compensationCents).toBe(Math.round((2 + 181 / 365) * 14 * 10_000));
  });

  it("adds diuturnidades to the base", () => {
    expect(run({ baseMonthly: 2900, seniorityPay: 100 }).compensationCents).toBe(run({}).compensationCents);
  });
});

describe("dismissal compensation, transitional regimes (Lei 69/2013, art. 5)", () => {
  it("pays 20 days up to 30 Sep 2013 then 18 days for the first three years, for contracts of 1 Nov 2011 to 30 Sep 2013", () => {
    // Started 2012-10-01: exactly 1 year to 2013-10-01 at 20 days, then 2 more years up to 3 at 18, the rest at 12.
    const result = run({ startDate: "2012-10-01", endDate: "2026-09-30" });
    expect(result.regime).toBe("from2011");
    expect(result.seniorityYears).toBeCloseTo(14, 10);
    const lines = Object.fromEntries(result.lines.map((line) => [line.key, line]));
    expect(lines.twentyDays.years).toBeCloseTo(1, 10);
    expect(lines.eighteenDays.years).toBeCloseTo(2, 10);
    // 12 days from 1 Oct 2015 to 30 Apr 2023 (7 years and 212 of 365 days), then 14 days.
    expect(lines.twelveDays.years).toBeCloseTo(7 + 212 / 365, 2);
    expect(lines.fourteenDays.years).toBeCloseTo(14 - (10 + 212 / 365), 1);
    expect(result.compensationCents).toBe(result.lines.reduce((sum, line) => sum + line.amountCents, 0));
    expect(lines.eighteenDays.amountCents).toBe(Math.round(2 * 18 * 10_000));
  });

  it("pays only 12 days after 2013 when the contract was already three years old on 1 Oct 2013", () => {
    // Started 2010-10-01: three years on 2013-10-01, so no 18-day period.
    const result = run({ baseMonthly: 1000, startDate: "2010-10-01", endDate: "2026-09-30" });
    expect(result.regime).toBe("before2011");
    const lines = Object.fromEntries(result.lines.map((line) => [line.key, line]));
    expect(lines.eighteenDays).toBeUndefined();
    expect(lines.oneMonth.years).toBeCloseTo(2 + 31 / 366 + 0, 1); // 2010-10-01 to 2012-11-01
    // Three years old on 1 Oct 2013: 12 days up to 30 Apr 2023, 14 days from 1 May 2023.
    expect(lines.twelveDays.years).toBeCloseTo(9 + 212 / 365, 2);
    expect(lines.fourteenDays.years).toBeCloseTo(16 - 12 - 212 / 365, 1);
  });

  it("uses a month per year up to 31 Oct 2012 and 20 days to 30 Sep 2013 for contracts before 1 Nov 2011", () => {
    // Started 2011-01-01 on 1500 a month (50 a day): 1y 305/366 days at 30 days, then 334/365 at 20 days, then 12 days.
    const result = run({ baseMonthly: 1500, startDate: "2011-01-01", endDate: "2026-12-31" });
    const lines = Object.fromEntries(result.lines.map((line) => [line.key, line]));
    // The contract was 2.75 years old on 1 Oct 2013, so the remaining quarter of the first three years counts 18 days.
    expect(lines.eighteenDays.years).toBeCloseTo(3 - lines.oneMonth.years - lines.twentyDays.years, 10);
    expect(lines.oneMonth.daysPerYear).toBe(30);
    expect(lines.oneMonth.years).toBeCloseTo(1 + 305 / 366, 2);
    expect(lines.twentyDays.years).toBeCloseTo(334 / 365, 2);
    expect(lines.twelveDays.years + lines.fourteenDays.years).toBeCloseTo(result.seniorityYears - 3, 10);
    expect(lines.oneMonth.amountCents).toBe(Math.round(lines.oneMonth.years * 30 * 5000));
  });
});

describe("caps", () => {
  it("caps the whole amount at 12 monthly bases when the part up to 30 Sep 2013 stays below it", () => {
    // Started 2005-01-01: 254 days up to 2013, then 12 days a year for 13 years, 413 days in all, capped at 360.
    const result = run({ baseMonthly: 2000, startDate: "2005-01-01", endDate: "2026-12-31" });
    expect(result.uncappedCents).toBeGreaterThan(result.capCents);
    expect(result.caps).toEqual({ monthlyBase: false, total: true, earlyPartExceedsCap: false });
    expect(result.compensationCents).toBe(12 * 200_000);
  });

  it("adds nothing after 30 Sep 2013 when the earlier part alone reaches the cap (art. 5(5)(a))", () => {
    const result = run({ baseMonthly: 2000, startDate: "1986-01-01", endDate: "2026-12-31" });
    expect(result.caps.earlyPartExceedsCap).toBe(true);
    const early = result.lines.filter((line) => line.key === "oneMonth" || line.key === "twentyDays");
    expect(result.compensationCents).toBe(early.reduce((sum, line) => sum + line.amountCents, 0));
    expect(result.compensationCents).toBeGreaterThan(result.capCents);
  });

  it("limits the monthly base to 20 minimum wages and the total to 240 minimum wages", () => {
    const result = run({ baseMonthly: 50_000, startDate: "2005-01-01", endDate: "2026-12-31" });
    expect(result.caps.monthlyBase).toBe(true);
    expect(result.usedMonthlyCents).toBe(20 * RMMG_2026_CENTS);
    expect(result.capCents).toBe(240 * RMMG_2026_CENTS);
    expect(result.compensationCents).toBe(240 * RMMG_2026_CENTS);
  });
});

describe("worked example", () => {
  it("is valid and sits between its bounds", () => {
    const outcome = computeDismissalCompensation(DISMISSAL_EXAMPLE, "2026-11-19");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.regime).toBe("from2011");
    expect(outcome.result.compensationCents).toBeGreaterThan(0);
    expect(outcome.result.compensationCents).toBeLessThanOrEqual(outcome.result.capCents);
  });
});

describe("fixed-term contract expiry (arts. 344(2) and 345(4) CT, Lei 13/2023)", () => {
  const fixed = (overrides: Partial<DismissalCompensationInput> = {}) =>
    run({ contractType: "fixedTerm", startDate: "2025-01-01", endDate: "2026-12-31", ...overrides });

  it("pays 24 days of base pay and diuturnidades per year, on the whole duration", () => {
    // Exactly 2 years at 100 euros a day (3000 / 30): 2 x 24 x 100 = 4800 euros.
    const result = fixed();
    expect(result.regime).toBe("fixedTerm");
    expect(result.seniorityYears).toBeCloseTo(2, 10);
    expect(result.lines.map((line) => line.key)).toEqual(["twentyFourDays"]);
    expect(result.lines[0].daysPerYear).toBe(24);
    expect(result.compensationCents).toBe(2 * 24 * 10_000);
    expect(result.caps).toEqual({ monthlyBase: false, total: false, earlyPartExceedsCap: false });
  });

  it("applies 24 days to a contract signed before 1 May 2023 that expires in 2026 (IGeFE nota informativa 10/2023, art. 35(1) of Lei 13/2023)", () => {
    // 2021-01-01 to 2026-12-31 is 6 years: no 12/14-day split, no early regimes.
    const result = fixed({ startDate: "2021-01-01" });
    expect(result.lines.map((line) => line.key)).toEqual(["twentyFourDays"]);
    expect(result.compensationCents).toBe(6 * 24 * 10_000);
    const old = fixed({ startDate: "2010-05-03" }); // would be a 2013 transitional contract if permanent
    expect(old.regime).toBe("fixedTerm");
    expect(old.lines.map((line) => line.key)).toEqual(["twentyFourDays"]);
  });

  it("counts a fraction of a year proportionally and adds diuturnidades", () => {
    const result = fixed({ baseMonthly: 2900, seniorityPay: 100, startDate: "2026-01-01", endDate: "2026-06-30" });
    expect(result.seniorityYears).toBeCloseTo(181 / 365, 10);
    expect(result.compensationCents).toBe(Math.round((181 / 365) * 24 * 10_000));
  });

  it("limits the monthly base to 20 times the minimum wage and the total to 12 monthly amounts (art. 366(2))", () => {
    const rich = fixed({ baseMonthly: 50_000, startDate: "2025-01-01" });
    expect(rich.usedMonthlyCents).toBe(20 * RMMG_2026_CENTS);
    expect(rich.caps.monthlyBase).toBe(true);
    // 17 years x 24 days = 408 days: above 12 x 30 = 360 days, so the total cap binds.
    const long = fixed({ baseMonthly: 1500, startDate: "2009-12-31" });
    expect(long.caps.total).toBe(true);
    expect(long.compensationCents).toBe(12 * 150_000);
    expect(long.caps.earlyPartExceedsCap).toBe(false);
  });

  describe("worked examples of IGeFE Nota Informativa n.º 10/2023 (24 x daily pay x days / 365), moved to 2026 dates", () => {
    // IGeFE rounds the daily pay to the cent before multiplying; the calculator keeps it unrounded, so the totals differ
    // by a few cents. The note's examples run from 1 September to 31 August, and from 1 April to 8 August.
    const igefe = (monthly: number, days: number) => Math.round(Math.round((monthly / 30) * 100) / 100 * 24 * days / 365 * 100);
    const cases = [
      // Técnico especializado, one school year at 1,456.18 a month: IGeFE 1,164.96.
      { monthly: 1456.18, start: "2025-09-01", end: "2026-08-31", days: 365, igefeCents: 116_496, cents: 116_494 },
      // The same contract renewed for a second year (730 days): IGeFE 2,329.92.
      { monthly: 1456.18, start: "2024-09-01", end: "2026-08-31", days: 730, igefeCents: 232_992, cents: 232_989 },
      // Docente, 1 April to 8 August (130 days) at 1,604.90 a month: IGeFE 457.32.
      { monthly: 1604.9, start: "2026-04-01", end: "2026-08-08", days: 130, igefeCents: 45_732, cents: 45_729 },
    ];
    it.each(cases)("$start to $end at $monthly a month", ({ monthly, start, end, days, igefeCents, cents }) => {
      expect(igefe(monthly, days)).toBe(igefeCents);
      const result = fixed({ baseMonthly: monthly, startDate: start, endDate: end });
      expect(result.seniorityYears).toBeCloseTo(days / 365, 10);
      expect(result.compensationCents).toBe(cents);
      expect(Math.abs(result.compensationCents - igefeCents)).toBeLessThanOrEqual(5);
    });
  });

  it("leaves permanent contracts untouched", () => {
    expect(run({ contractType: "permanent" }).regime).toBe("from2013");
  });
});

describe("fixed-term duration limits (arts. 147(2)(b) and 148 CT; art. 11(4) of Lei 93/2019)", () => {
  it("uses 2 and 4 years from 1 October 2019, and 3 and 6 years for contracts signed before (art. 148, initial and Lei 93/2019 wording)", () => {
    expect(LEI_93_2019_IN_FORCE).toBe("2019-10-01");
    expect(FIXED_TERM_MAX_YEARS).toEqual({ from2019: { certain: 2, uncertain: 4 }, before2019: { certain: 3, uncertain: 6 } });
  });

  const cases: { kind: FixedTermKind; start: string; end: string; rules: "from2019" | "before2019"; maxYears: number; lastDay: string; exceeded: boolean }[] = [
    // Certain term from 1 October 2019: at most 2 years (art. 148(1)).
    { kind: "certain", start: "2024-07-01", end: "2026-06-29", rules: "from2019", maxYears: 2, lastDay: "2026-06-30", exceeded: false },
    { kind: "certain", start: "2024-07-01", end: "2026-06-30", rules: "from2019", maxYears: 2, lastDay: "2026-06-30", exceeded: false },
    { kind: "certain", start: "2024-07-01", end: "2026-07-01", rules: "from2019", maxYears: 2, lastDay: "2026-06-30", exceeded: true },
    // Uncertain term from 1 October 2019: at most 4 years (art. 148(5)).
    { kind: "uncertain", start: "2022-03-01", end: "2026-02-27", rules: "from2019", maxYears: 4, lastDay: "2026-02-28", exceeded: false },
    { kind: "uncertain", start: "2022-03-01", end: "2026-02-28", rules: "from2019", maxYears: 4, lastDay: "2026-02-28", exceeded: false },
    { kind: "uncertain", start: "2022-03-01", end: "2026-03-01", rules: "from2019", maxYears: 4, lastDay: "2026-02-28", exceeded: true },
    // Signed before 1 October 2019: the initial wording of art. 148 keeps applying (art. 11(4) of Lei 93/2019).
    { kind: "certain", start: "2018-06-01", end: "2020-12-31", rules: "before2019", maxYears: 3, lastDay: "2021-05-31", exceeded: false },
    { kind: "certain", start: "2018-06-01", end: "2021-05-31", rules: "before2019", maxYears: 3, lastDay: "2021-05-31", exceeded: false },
    { kind: "certain", start: "2018-06-01", end: "2021-06-01", rules: "before2019", maxYears: 3, lastDay: "2021-05-31", exceeded: true },
    { kind: "uncertain", start: "2015-01-01", end: "2020-12-30", rules: "before2019", maxYears: 6, lastDay: "2020-12-31", exceeded: false },
    { kind: "uncertain", start: "2015-01-01", end: "2020-12-31", rules: "before2019", maxYears: 6, lastDay: "2020-12-31", exceeded: false },
    { kind: "uncertain", start: "2015-01-01", end: "2021-01-01", rules: "before2019", maxYears: 6, lastDay: "2020-12-31", exceeded: true },
    // The day Lei 93/2019 came into force (art. 13(1)) is the first under the new limits.
    { kind: "certain", start: "2019-09-30", end: "2022-09-29", rules: "before2019", maxYears: 3, lastDay: "2022-09-29", exceeded: false },
    { kind: "certain", start: "2019-10-01", end: "2022-09-29", rules: "from2019", maxYears: 2, lastDay: "2021-09-30", exceeded: true },
  ];
  it.each(cases)("$kind term from $start to $end: $rules, exceeded $exceeded", ({ kind, start, end, rules, maxYears, lastDay, exceeded }) => {
    expect(checkFixedTermDuration(kind, start, end)).toEqual({ kind, rules, maxYears, lastDay, exceeded });
  });

  it("gives a start on 29 February the whole of 28 February in a year without one", () => {
    expect(checkFixedTermDuration("certain", "2024-02-29", "2026-02-28")).toMatchObject({ lastDay: "2026-02-28", exceeded: false });
    expect(checkFixedTermDuration("certain", "2024-02-29", "2026-03-01")).toMatchObject({ exceeded: true });
  });

  it("returns nothing for invalid dates", () => {
    expect(checkFixedTermDuration("certain", "", "2026-01-01")).toBeNull();
    expect(checkFixedTermDuration("certain", "2026-02-30", "2026-03-01")).toBeNull();
  });

  describe("in the calculator, non-blocking", () => {
    const fixed = (overrides: Partial<DismissalCompensationInput>) => run({ contractType: "fixedTerm", ...overrides });

    it("flags a certain-term contract over 2 years and still pays 24 days a year on the whole duration", () => {
      // 2024-01-01 to 2026-12-31 is 3 years: over the limit, which was reached on 31 December 2025.
      const result = fixed({ startDate: "2024-01-01", endDate: "2026-12-31" });
      expect(result.durationLimit).toEqual({ kind: "certain", rules: "from2019", maxYears: 2, lastDay: "2025-12-31", exceeded: true });
      expect(result.regime).toBe("fixedTerm");
      expect(result.compensationCents).toBe(3 * 24 * 10_000);
    });

    it("does not flag the same dates on an uncertain term, which may last 4 years", () => {
      const result = fixed({ fixedTermKind: "uncertain", startDate: "2024-01-01", endDate: "2026-12-31" });
      expect(result.durationLimit).toMatchObject({ maxYears: 4, exceeded: false });
      expect(result.compensationCents).toBe(3 * 24 * 10_000);
    });

    it("flags an uncertain-term contract over 4 years", () => {
      expect(fixed({ fixedTermKind: "uncertain", startDate: "2022-06-01", endDate: "2026-06-01" }).durationLimit)
        .toMatchObject({ lastDay: "2026-05-31", exceeded: true });
      expect(fixed({ fixedTermKind: "uncertain", startDate: "2022-06-01", endDate: "2026-05-31" }).durationLimit)
        .toMatchObject({ exceeded: false });
    });

    it("applies the pre-2019 limits to a contract that started before 1 October 2019; ending in 2026 it has passed them too", () => {
      expect(fixed({ fixedTermKind: "uncertain", startDate: "2019-09-30", endDate: "2026-01-31" }).durationLimit)
        .toEqual({ kind: "uncertain", rules: "before2019", maxYears: 6, lastDay: "2025-09-29", exceeded: true });
    });

    it("has no limit for a permanent contract", () => {
      expect(run({ contractType: "permanent", fixedTermKind: "uncertain" }).durationLimit).toBeNull();
    });

    it("does not change the amount: the kind of term only selects the limit", () => {
      for (const [startDate, endDate] of [["2024-01-01", "2026-12-31"], ["2025-03-15", "2026-03-14"], ["2009-12-31", "2026-12-31"]]) {
        const certain = fixed({ startDate, endDate });
        const uncertain = fixed({ fixedTermKind: "uncertain", startDate, endDate });
        expect({ ...uncertain, durationLimit: null }).toEqual({ ...certain, durationLimit: null });
      }
    });
  });
});

describe("validation", () => {
  const check = (overrides: Partial<DismissalCompensationInput>) => validateDismissal(base(overrides), "2026-11-19");
  it("rejects an end before the start", () => {
    expect(check({ startDate: "2026-06-01", endDate: "2026-05-01" }).endDate).toBe("endBeforeStart");
  });
  it("rejects a start in the future", () => {
    expect(check({ startDate: "2026-12-01", endDate: "2026-12-31" }).startDate).toBe("startFuture");
  });
  it("rejects an end outside the year whose minimum wage the caps use", () => {
    expect(check({ endDate: "2027-03-31" }).endDate).toBe("endOutsideYear");
    expect(check({ endDate: "2025-12-31" }).endDate).toBe("endOutsideYear");
  });
  it("rejects zero, empty and huge pay", () => {
    expect(check({ baseMonthly: 0 }).baseMonthly).toBe("tooSmall");
    expect(check({ baseMonthly: Number.NaN }).baseMonthly).toBe("required");
    expect(check({ baseMonthly: 2_000_000 }).baseMonthly).toBe("tooLarge");
    expect(check({ seniorityPay: -1 }).seniorityPay).toBe("tooSmall");
  });
  it("rejects missing and impossible dates", () => {
    expect(check({ startDate: "" }).startDate).toBe("required");
    expect(check({ endDate: "2026-02-30" }).endDate).toBe("invalidDate");
  });
  it("does not compute with errors", () => {
    expect(computeDismissalCompensation(base({ baseMonthly: 0 }), "2026-11-19").ok).toBe(false);
  });
});

describe("payout split", () => {
  it("adds up to the total", () => {
    const parts = splitPayout(100_001, 6);
    expect(parts).toHaveLength(6);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(100_001);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });
});
