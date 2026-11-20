import { describe, expect, it } from "vitest";
import {
  INCREASE_MAX_REFERENCE_MONTHLY_CENTS, MIN_DAILY_CENTS, SICK_PAY_EXAMPLE, SICK_PAY_SOURCES, computeSickPay, floorDailyCents,
  type SickPayInput,
} from "./sickPay";

function run(overrides: Partial<SickPayInput> = {}) {
  const outcome = computeSickPay({ ...SICK_PAY_EXAMPLE, ...overrides });
  if (!outcome.ok) throw new Error(`expected a valid input: ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
}

describe("2026 values", () => {
  it("has a minimum of 9.20 a day, 30% of the minimum wage", () => {
    expect(MIN_DAILY_CENTS).toBe(920);
  });
});

describe("benefit by duration band", () => {
  it("pays 55% then 60% and leaves the 3 waiting days unpaid", () => {
    const result = run(); // 1500 a month: reference 50.00 a day
    expect(result.referenceDailyCents).toBe(5000);
    expect(result.waitingDays).toBe(3);
    expect(result.bands.map((band) => [band.percent, band.days, band.paidDays, band.dailyCents])).toEqual([
      [55, 30, 27, 2750],
      [60, 15, 15, 3000],
    ]);
    expect(result.totalCents).toBe(27 * 2750 + 15 * 3000);
  });

  it("reaches the 70% and 75% bands for long leaves", () => {
    const result = run({ sickDays: 400 });
    expect(result.bands.map((band) => [band.percent, band.days])).toEqual([[55, 30], [60, 60], [70, 275], [75, 35]]);
    expect(result.bands.reduce((sum, band) => sum + band.days, 0)).toBe(400);
  });

  it("pays from day 1 with a hospitalisation", () => {
    const result = run({ hospitalisation: true });
    expect(result.waitingDays).toBe(0);
    expect(result.bands[0].paidDays).toBe(30);
  });

  it("pays nothing when the whole leave is inside the waiting period", () => {
    const result = run({ sickDays: 3 });
    expect(result.totalCents).toBe(0);
    expect(result.paidDays).toBe(0);
    expect(result.waitingDays).toBe(3);
    expect(run({ sickDays: 1 }).waitingDays).toBe(1);
  });

  it("excludes the allowances when the salary is in twelfths", () => {
    expect(run({ grossMonthly: 1750, allowances: "twelfths" }).referenceDailyCents).toBe(5000);
  });
});

describe("limits and increase", () => {
  it("raises low reference pay to the 9.20 minimum", () => {
    const result = run({ grossMonthly: 600 }); // 20.00 a day, 55% = 11.00 > 9.20
    expect(result.bands[0].dailyCents).toBe(1100);
    const low = run({ grossMonthly: 420 }); // 14.00 a day, 55% = 7.70 -> 9.20
    expect(low.bands[0].dailyCents).toBe(920);
    expect(low.limit).toBe("minimum");
  });

  it("pays the reference pay itself when it is below the minimum", () => {
    const result = run({ grossMonthly: 240 }); // 8.00 a day
    expect(result.bands[0].dailyCents).toBe(800);
    expect(result.limit).toBe("referencePay");
  });

  it("adds 5 points on the 55% and 60% bands for a reference pay of 500 or less, whatever the household", () => {
    const result = run({ grossMonthly: 480, dependants: 0, sickDays: 100 }); // 16.00 a day, 480 a month
    expect(result.increaseApplied).toBe(true);
    expect(result.bands.map((band) => band.percent)).toEqual([60, 65, 70]);
    expect(run({ grossMonthly: 500, dependants: 0 }).increaseApplied).toBe(true);
    expect(run({ grossMonthly: 500.01, dependants: 0 }).increaseApplied).toBe(false);
  });

  it("adds 5 points for 3 or more descendants, whatever the reference pay (art. 17 DL 28/2004: the conditions are alternatives)", () => {
    const result = run({ grossMonthly: 1500, dependants: 3, sickDays: 100 });
    expect(result.increaseApplied).toBe(true);
    expect(result.bands.map((band) => band.percent)).toEqual([60, 65, 70]);
    expect(run({ grossMonthly: 1500, dependants: 2 }).increaseApplied).toBe(false);
    expect(run({ grossMonthly: 600, dependants: 2 }).increaseApplied).toBe(false);
  });

  describe("disability bonus on child benefit (art. 17(1)(c) DL 28/2004)", () => {
    it("adds 5 points above 500 euros, where neither other condition applies", () => {
      const result = run({ grossMonthly: 1500, dependants: 0, disabilityBonus: true, sickDays: 100 });
      expect(result.increaseApplied).toBe(true);
      expect(result.bands.map((band) => [band.percent, band.dailyCents])).toEqual([
        [60, 3000], [65, 3250], [70, 3500],
      ]);
      expect(result.limit).toBe("none");
      expect(run({ grossMonthly: 1500, dependants: 0, disabilityBonus: false }).increaseApplied).toBe(false);
    });

    it("adds 5 points just above 500 euros, where the art. 17(2) floor would otherwise apply", () => {
      // 520 a month, 17.33 a day: 60% is 10.40 and 65% is 11.26, both above the floors of 10.00 and 10.84.
      const result = run({ grossMonthly: 520, dependants: 0, disabilityBonus: true, sickDays: 60 });
      expect(result.increaseApplied).toBe(true);
      expect(result.bands.map((band) => [band.percent, band.dailyCents])).toEqual([[60, 1040], [65, 1126]]);
      expect(result.limit).toBe("none");
    });

    it("adds the 5 points once at 500 euros or less: the increases are not cumulative (art. 17(3))", () => {
      const without = run({ grossMonthly: 480, dependants: 0, sickDays: 100 });
      const withBonus = run({ grossMonthly: 480, dependants: 0, disabilityBonus: true, sickDays: 100 });
      expect(withBonus.increaseApplied).toBe(true);
      expect(withBonus.bands.map((band) => band.percent)).toEqual([60, 65, 70]);
      expect(withBonus).toEqual(without);
    });

    it("adds the 5 points once with 3 or more descendants too", () => {
      const without = run({ grossMonthly: 1500, dependants: 3, sickDays: 100 });
      const withBonus = run({ grossMonthly: 1500, dependants: 3, disabilityBonus: true, sickDays: 100 });
      expect(withBonus.bands.map((band) => band.percent)).toEqual([60, 65, 70]);
      expect(withBonus).toEqual(without);
      const allThree = run({ grossMonthly: 480, dependants: 3, disabilityBonus: true, sickDays: 100 });
      expect(allThree.bands.map((band) => band.percent)).toEqual([60, 65, 70]);
    });

    it("leaves the 70% and 75% bands as they are", () => {
      const result = run({ grossMonthly: 1500, disabilityBonus: true, sickDays: 400 });
      expect(result.bands.map((band) => band.percent)).toEqual([60, 65, 70, 75]);
    });

    it("is off in the example, so the default results do not change", () => {
      expect(SICK_PAY_EXAMPLE.disabilityBonus).toBe(false);
    });
  });

  it("keeps the 500 euro threshold: the Segurança Social guide v4.55 (23 October 2026) still says 500,00 euros", () => {
    expect(INCREASE_MAX_REFERENCE_MONTHLY_CENTS).toBe(50_000);
  });

  it("never pays less above 500 than the increased benefit on 500 (art. 17(2) DL 28/2004)", () => {
    // 520 a month, 17.33 a day: 55% is 9.53 and 60% is 10.40, below the floors of 10.00 (60% of 16.67) and 10.84 (65%).
    const result = run({ grossMonthly: 520, dependants: 0, sickDays: 100 });
    expect(result.increaseApplied).toBe(false);
    expect(result.bands.map((band) => band.percent)).toEqual([55, 60, 70]);
    expect(result.bands[0].dailyCents).toBe(1000);
    expect(result.bands[1].dailyCents).toBe(1084);
    expect(result.limit).toBe("floor");
    // 70% is not covered by art. 17(2): 520 / 30 x 70% = 12.13.
    expect(result.bands[2].dailyCents).toBe(Math.round((1733 * 70) / 100));
  });

  it("does not raise the benefit once the percentage already exceeds the floor, or at 500 or less", () => {
    // 545.46 a month: 18.182 a day x 55% = 10.00, the floor is no longer above the plain benefit.
    expect(run({ grossMonthly: 600, sickDays: 10 }).bands[0].dailyCents).toBe(Math.round((2000 * 55) / 100));
    expect(run({ grossMonthly: 600, sickDays: 10 }).limit).toBe("none");
    expect(run({ grossMonthly: 500, sickDays: 10 }).bands[0].dailyCents).toBe(Math.round((1667 * 60) / 100));
    // With 3 children the 5 points already apply, so 60% of 520 / 30 is above 10.00.
    expect(run({ grossMonthly: 520, dependants: 3, sickDays: 10 }).bands[0].dailyCents).toBe(Math.round((1733 * 60) / 100));
  });

  it("sets the art. 17(2) floor at the increased 60% and 65% of 500 euros a month", () => {
    // 500 / 30 = 16.67 a day, rounded to the cent like any reference pay.
    expect(floorDailyCents(55)).toBe(1000); // 16.67 x 60% = 10.002
    expect(floorDailyCents(60)).toBe(1084); // 16.67 x 65% = 10.8355
  });

  it("keeps the benefit continuous across 500 euros, as art. 17(2) intends", () => {
    // Without the floor, 500.01 would drop to 55% of 16.67 = 9.17 a day, below what 500.00 pays.
    const at500 = run({ grossMonthly: 500, dependants: 0, sickDays: 60 });
    const above = run({ grossMonthly: 500.01, dependants: 0, sickDays: 60 });
    expect(at500.increaseApplied).toBe(true);
    expect(above.increaseApplied).toBe(false);
    expect(above.limit).toBe("floor");
    expect(above.bands.map((band) => band.dailyCents)).toEqual(at500.bands.map((band) => band.dailyCents));
  });

  it("never pays more than the net reference pay", () => {
    const result = run({ grossMonthly: 30_000, sickDays: 500 });
    const last = result.bands.at(-1)!;
    // Reference pay is 1000.00 a day: 75% would be 750.00, the net cap is lower.
    expect(last.dailyCents).toBeLessThan(75_000);
    expect(result.limit).toBe("netCap");
  });
});

describe("income gap", () => {
  it("compares the benefit with normal net pay", () => {
    const result = run();
    expect(result.netMonthlyCents).toBeGreaterThan(result.firstMonthGapCents);
    expect(result.firstMonthGapCents).toBe(result.netMonthlyCents - 27 * 2750);
    expect(result.averageMonthlyGapCents).toBeGreaterThan(0);
  });

  it("is never negative", () => {
    expect(run({ grossMonthly: 240 }).averageMonthlyGapCents).toBeGreaterThanOrEqual(0);
  });
});

describe("validation", () => {
  it("rejects bad numbers with a field error", () => {
    const bad = computeSickPay({ ...SICK_PAY_EXAMPLE, sickDays: 0, grossMonthly: Number.NaN, dependants: 1.5 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toEqual({ sickDays: "tooSmall", grossMonthly: "required", dependants: "whole" });
    const tooLong = computeSickPay({ ...SICK_PAY_EXAMPLE, sickDays: 1096 });
    expect(tooLong.ok).toBe(false);
  });
});

describe("sources", () => {
  it("cites the Diário da República consolidated decree-law and the Segurança Social guide document", () => {
    expect(SICK_PAY_SOURCES.law).toBe("https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/2004-34545075");
    // The old www.seg-social.pt/subsidio-de-doenca address now redirects to the portal home page.
    expect(SICK_PAY_SOURCES.guide).toMatch(/^https:\/\/www\.seg-social\.pt\/ptss\/pssd\/documento\//);
  });
});
