import { describe, expect, it } from "vitest";
import {
  IAS_2026_CENTS,
  NORMAL_AGE_2026_MONTHS,
  STATE_PENSION_EXAMPLE,
  STATE_PENSION_SOURCES,
  computeStatePension,
  lateBonusBp,
  minimumPensionCents,
  statutoryPensionCents,
  validateStatePension,
  type StatePensionInput,
} from "./statePension";

function run(overrides: Partial<StatePensionInput> = {}) {
  const outcome = computeStatePension({ ...STATE_PENSION_EXAMPLE, ...overrides });
  if (!outcome.ok) throw new Error(`expected a valid input: ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
}

describe("2026 reference values", () => {
  it("reuses the IAS of the unemployment calculator and the published ages", () => {
    expect(IAS_2026_CENTS).toBe(53_713);
    expect(NORMAL_AGE_2026_MONTHS).toBe(801);
  });
});

describe("statutory pension (P2 whole-career formula)", () => {
  it("reproduces the published 40-year example: 1 500 EUR gives a 90.22% rate and 1 353.30", () => {
    const result = run({ grossMonthly: 1500, years: 40, ageYears: 66, ageMonths: 9 });
    expect(result.globalRateBp).toBe(9022);
    expect(result.statutoryCents).toBe(135_330);
    expect(result.monthlyCents).toBe(135_330);
  });

  it("applies each rate to its slice of the reference remuneration", () => {
    const iasHundredths = (n: number) => (IAS_2026_CENTS * n) / 100;
    // Entirely in the first band: 2.3% a year.
    expect(statutoryPensionCents(50_000, 30)).toBe(Math.round(50_000 * 0.023 * 30));
    // Up to 1.1 IAS at 2.3% and the rest at 2.25%.
    const reference = Math.round(iasHundredths(150));
    const expected = (iasHundredths(110) * 0.023 + (reference - iasHundredths(110)) * 0.0225) * 25;
    expect(statutoryPensionCents(reference, 25)).toBe(Math.round(expected));
  });

  it("uses a flat 2% a year up to 20 years and counts at most 40 years", () => {
    expect(statutoryPensionCents(100_000, 20)).toBe(40_000);
    expect(statutoryPensionCents(100_000, 21)).toBeGreaterThan(Math.round(100_000 * 0.02 * 21));
    expect(statutoryPensionCents(150_000, 45)).toBe(statutoryPensionCents(150_000, 40));
  });

  it("pays 2% on the slice above 8 IAS", () => {
    const high = 1_000_000;
    expect(statutoryPensionCents(high, 40) / high / 40).toBeGreaterThan(0.02);
    expect(statutoryPensionCents(high, 40) / high / 40).toBeLessThan(0.0225);
  });
});

describe("early and late retirement", () => {
  it("does not adjust at the normal age", () => {
    const result = run({ ageYears: 66, ageMonths: 9 });
    expect(result.adjustment).toBe("none");
    expect(result.monthlyCents).toBe(result.statutoryCents);
  });

  it("multiplies 0.5% a month and the 2026 sustainability factor before the normal age", () => {
    const result = run({ grossMonthly: 1800, years: 38, ageYears: 63, ageMonths: 0 });
    expect(result.statutoryCents).toBe(153_644);
    expect(result.adjustment).toBe("early");
    expect(result.adjustmentMonths).toBe(45);
    expect(result.penaltyBp).toBe(2250);
    expect(result.monthlyCents).toBe(98_081);
    expect(result.gapCents).toBe(result.netPayCents - result.netPensionCents);
  });

  it("cuts 40.5% plus the factor at 60", () => {
    const result = run({ grossMonthly: 1500, years: 38, ageYears: 60, ageMonths: 0 });
    expect(result.penaltyBp).toBe(4050);
    expect(result.monthlyCents).toBe(63_009);
  });

  it("does not apply the minimum pension to early retirement", () => {
    const result = run({ grossMonthly: 500, years: 16, ageYears: 60, ageMonths: 0 });
    expect(result.floor).toBe("none");
  });

  it("adds the monthly bonus after the normal age, capped at 92% of the reference pay", () => {
    const capped = run({ grossMonthly: 1800, years: 38, ageYears: 68, ageMonths: 0 });
    expect(capped.adjustment).toBe("late");
    expect(capped.adjustmentMonths).toBe(15);
    expect(capped.bonusCapped).toBe(true);
    expect(capped.monthlyCents).toBe(165_600);
    const uncapped = run({ grossMonthly: 1800, years: 38, ageYears: 67, ageMonths: 0 });
    // 3 months x 0.65%.
    expect(uncapped.bonusBp).toBe(195);
    expect(uncapped.monthlyCents).toBe(Math.round((153_644 * 10_195) / 10_000));
  });

  it("never lowers a pension that is already above the cap", () => {
    const result = run({ grossMonthly: 1000, years: 40, ageYears: 69, ageMonths: 0 });
    expect(result.monthlyCents).toBeGreaterThanOrEqual(result.statutoryCents);
  });
});

describe("minimum pensions", () => {
  it("looks up the 2026 amounts by years of contributions", () => {
    expect(minimumPensionCents(15)).toBe(35_780);
    expect(minimumPensionCents(20)).toBe(35_780);
    expect(minimumPensionCents(21)).toBe(39_482);
    expect(minimumPensionCents(30)).toBe(39_482);
    expect(minimumPensionCents(31)).toBe(49_352);
  });

  it("raises a low pension to the floor at the normal age", () => {
    const result = run({ grossMonthly: 600, years: 16, ageYears: 67, ageMonths: 0 });
    expect(result.floor).toBe("minimum");
    expect(result.monthlyCents).toBe(35_780);
  });
});

describe("bonus table", () => {
  it("steps with the years of contributions", () => {
    expect([15, 24, 25, 34, 35, 39, 40].map(lateBonusBp)).toEqual([33, 33, 50, 50, 65, 65, 100]);
  });
});

describe("replacement rate and gap", () => {
  it("compares the net pension (IRS withheld, no Social Security) with today's net pay", () => {
    const result = run();
    expect(result.replacementBp).toBe(Math.round((result.monthlyCents / 180_000) * 10_000));
    expect(result.netPayCents).toBe(136_153);
    // Pension 1132.68: table VIII, 15.7% x 1132.68 - 111.70 = 66.13.
    expect(result.monthlyCents).toBe(113_268);
    expect(result.pensionWithholdingCents).toBe(6613);
    expect(result.netPensionCents).toBe(113_268 - 6613);
    expect(result.gapCents).toBe(result.netPayCents - result.netPensionCents);
  });

  it("does not tax a pension of up to 920 euros", () => {
    const result = run({ grossMonthly: 700, years: 38, ageYears: 66, ageMonths: 9 });
    expect(result.monthlyCents).toBeLessThanOrEqual(92_000);
    expect(result.pensionWithholdingCents).toBe(0);
    expect(result.netPensionCents).toBe(result.monthlyCents);
  });

  it("reports no gap when the net pension exceeds net pay", () => {
    expect(run({ grossMonthly: 1500, years: 40, ageYears: 66, ageMonths: 9 }).gapCents).toBe(0);
  });
});

describe("validation", () => {
  const errors = (overrides: Partial<StatePensionInput>) => validateStatePension({ ...STATE_PENSION_EXAMPLE, ...overrides });

  it("rejects careers under 15 years, impossible careers and ages outside 60 to 70", () => {
    expect(errors({ years: 12 }).years).toBe("belowMinimum");
    expect(errors({ years: 50, ageYears: 62 }).years).toBe("tooLongForAge");
    expect(errors({ ageYears: 58 }).ageYears).toBe("tooSmall");
    expect(errors({ ageYears: 71 }).ageYears).toBe("tooLarge");
    expect(errors({ ageYears: 70, ageMonths: 4 }).ageMonths).toBe("tooLarge");
    expect(errors({ grossMonthly: Number.NaN }).grossMonthly).toBe("required");
    expect(errors({ grossMonthly: 0 }).grossMonthly).toBe("tooSmall");
    expect(errors({ years: 20.5 }).years).toBe("whole");
  });

  it("returns errors instead of a result", () => {
    expect(computeStatePension({ ...STATE_PENSION_EXAMPLE, years: 5 }).ok).toBe(false);
  });
});

describe("sources", () => {
  it("links the Diário da República act behind pension table VIII", () => {
    expect(STATE_PENSION_SOURCES.withholding).toBe("https://diariodarepublica.pt/dr/detalhe/despacho/233-a-2026-998488151");
  });

  it("links Segurança Social pages that still exist", () => {
    // www.seg-social.pt/pensao-de-velhice and /reforma now redirect to the portal home page.
    expect(STATE_PENSION_SOURCES.guide).toMatch(/^https:\/\/www\.seg-social\.pt\/ptss\/pssd\/documento\//);
    expect(STATE_PENSION_SOURCES.simulator).toBe("https://www.seg-social.pt/ptss/pssd/menu/simuladores/simulador-pensoes");
  });
});
