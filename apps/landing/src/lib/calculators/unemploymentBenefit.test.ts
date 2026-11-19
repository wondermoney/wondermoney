import { describe, expect, it } from "vitest";
import {
  IAS_2026_CENTS,
  RMMG_2026_CENTS,
  UNEMPLOYMENT_EXAMPLE,
  benefitDuration,
  computeUnemploymentBenefit,
  type UnemploymentBenefitInput,
} from "./unemploymentBenefit";
import { computeWithholdingCents } from "./payroll";

function run(overrides: Partial<UnemploymentBenefitInput> = {}) {
  const outcome = computeUnemploymentBenefit({ ...UNEMPLOYMENT_EXAMPLE, ...overrides });
  if (!outcome.ok) throw new Error(`expected a valid input: ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
}

describe("2026 reference values", () => {
  it("uses the published IAS and minimum wage", () => {
    expect(IAS_2026_CENTS).toBe(53_713);
    expect(RMMG_2026_CENTS).toBe(92_000);
  });
});

describe("benefit amount", () => {
  it("reproduces the Segurança Social guide example (14 000 EUR over 12 months gives 758.36, no limit binding)", () => {
    // 1 000 EUR x 14 = 14 000 EUR. The guide does not give the household of its example: with one child the IRS
    // withholding rate is low enough for the 75% cap not to bind, and the guide says no limit applies.
    const result = run({ grossMonthly: 1000, household: "alone", dependants: 1 });
    expect(result.referenceDailyCents).toBe(3889);
    expect(result.calculatedMonthlyCents).toBe(75_836);
    expect(result.limit).toBe("none");
    expect(result.monthlyCents).toBe(75_836);
    // A single person without children has a higher withholding rate and the 75% cap does bind.
    expect(run({ grossMonthly: 1000, household: "alone", dependants: 0 }).limit).toBe("netCap");
  });

  it("takes the IRS rate from the tables at the net reference pay (reference pay minus 11%)", () => {
    // gov.pt: "taxa constante das tabelas de retenção de IRS de acordo com o valor líquido da remuneração de referência".
    const result = run({ grossMonthly: 1000, household: "alone", dependants: 0 });
    const referenceMonthly = 3889 * 30;
    const lookup = Math.round(referenceMonthly * 0.89);
    const rate = computeWithholdingCents(lookup, { region: "mainland", status: "single", dependants: 0 }) / lookup;
    expect(result.netReferenceMonthlyCents).toBe(Math.round(referenceMonthly * (0.89 - rate)));
    expect(result.limit).toBe("netCap");
    expect(result.monthlyCents).toBe(Math.round(result.netReferenceMonthlyCents * 0.75));
  });

  it("lets the 1 IAS floor win over the 75% cap, as art. 29 n.º 2 DL 220/2006 says ('sem prejuízo do n.º 1')", () => {
    const result = run({ grossMonthly: 800, allowances: "twelfths" });
    expect(result.netReferenceMonthlyCents * 0.75).toBeLessThan(IAS_2026_CENTS);
    expect(result.monthlyCents).toBe(IAS_2026_CENTS);
  });

  it("is 65% of the reference pay when no limit applies", () => {
    const result = run({ grossMonthly: 960, allowances: "twelfths" });
    expect(result.limit).toBe("none");
    expect(result.monthlyCents).toBe(Math.round(96_000 * 0.65));
  });

  it("caps at 2.5 IAS on a high salary", () => {
    const result = run({ grossMonthly: 6000 });
    expect(result.monthlyCents).toBe(134_283);
    expect(result.limit).toBe("max");
  });

  it("applies the 75% of net reference pay cap when it is lower than 2.5 IAS", () => {
    const result = run({ grossMonthly: 2200, allowances: "twelfths" });
    expect(result.monthlyCents).toBeLessThan(134_283);
    expect(result.monthlyCents).toBe(Math.round(result.netReferenceMonthlyCents * 0.75));
    expect(result.limit).toBe("netCap");
  });

  it("never exceeds either cap, whatever the salary", () => {
    for (const salary of [500, 1000, 1800, 2500, 4000, 9000, 100_000]) {
      const result = run({ grossMonthly: salary });
      expect(result.monthlyCents).toBeLessThanOrEqual(134_283);
    }
  });

  it("raises a low amount to the IAS", () => {
    const result = run({ grossMonthly: 800, allowances: "twelfths" });
    expect(result.monthlyCents).toBe(IAS_2026_CENTS);
    expect(result.limit).toBe("minimum");
  });

  it("raises to 1.15 IAS when the reference pay is at least the minimum wage", () => {
    // 940 x 12 / 12 = 940: 65% is 611, below 1.15 IAS = 617.70.
    const result = run({ grossMonthly: 940, allowances: "twelfths" });
    expect(result.monthlyCents).toBe(61_770);
    expect(result.limit).toBe("minimumWage");
  });

  it("drops the IAS floor when the net reference pay is below the IAS", () => {
    const result = run({ grossMonthly: 400, allowances: "twelfths" });
    expect(result.netReferenceMonthlyCents).toBeLessThan(IAS_2026_CENTS);
    expect(result.monthlyCents).toBeLessThan(IAS_2026_CENTS);
    expect(result.monthlyCents).toBeGreaterThan(0);
  });

  it("does not apply any reduction after 180 days: the total is the monthly amount times the days", () => {
    const result = run();
    expect(result.totalCents).toBe(Math.round((result.monthlyCents * result.duration.totalDays) / 30));
  });
});

describe("10% increase for households with children", () => {
  it("applies when both partners are unemployed with dependants", () => {
    const base = run({ grossMonthly: 1000, household: "partnerWorking", dependants: 1 });
    const increased = run({ grossMonthly: 1000, household: "partnerUnemployed", dependants: 1 });
    expect(increased.childrenIncrease).toBe(true);
    expect(increased.monthlyCents).toBe(Math.round(base.monthlyCents * 1.1));
  });

  it("applies to a single-parent household", () => {
    expect(run({ household: "singleParent", dependants: 2 }).childrenIncrease).toBe(true);
  });

  it("does not apply without dependants, with a working partner or alone", () => {
    expect(run({ household: "partnerUnemployed", dependants: 0 }).childrenIncrease).toBe(false);
    expect(run({ household: "partnerWorking", dependants: 2 }).childrenIncrease).toBe(false);
    expect(run({ household: "alone", dependants: 2 }).childrenIncrease).toBe(false);
  });

  it("still respects the 2.5 IAS cap", () => {
    expect(run({ grossMonthly: 6000, household: "singleParent", dependants: 1 }).monthlyCents).toBe(134_283);
  });
});

describe("duration", () => {
  it.each([
    [25, 12, 150], [25, 15, 210], [25, 23, 210], [25, 24, 330],
    [35, 14, 180], [35, 20, 330], [35, 30, 420],
    [45, 14, 210], [45, 20, 360], [45, 30, 540],
    [55, 14, 270], [55, 20, 480], [55, 30, 540],
  ])("age %i with %i months gives %i base days", (age, months, days) => {
    expect(benefitDuration(age, months, 0).baseDays).toBe(days);
  });

  it("changes band at 30, 40 and 50", () => {
    expect(benefitDuration(29, 30, 0).baseDays).toBe(330);
    expect(benefitDuration(30, 30, 0).baseDays).toBe(420);
    expect(benefitDuration(39, 30, 0).baseDays).toBe(420);
    expect(benefitDuration(40, 30, 0).baseDays).toBe(540);
    expect(benefitDuration(49, 14, 0).baseDays).toBe(210);
    expect(benefitDuration(50, 14, 0).baseDays).toBe(270);
  });

  it("adds days for each full 5 years with records in the last 20", () => {
    expect(benefitDuration(25, 30, 4).extraDays).toBe(0);
    expect(benefitDuration(25, 30, 5).extraDays).toBe(30);
    expect(benefitDuration(35, 30, 20).extraDays).toBe(120);
    expect(benefitDuration(45, 30, 12).extraDays).toBe(90);
    expect(benefitDuration(55, 30, 19).extraDays).toBe(180);
    expect(benefitDuration(55, 30, 20)).toEqual({ baseDays: 540, extraDays: 240, totalDays: 780 });
  });
});

describe("validation", () => {
  const errors = (overrides: Partial<UnemploymentBenefitInput>) => {
    const outcome = computeUnemploymentBenefit({ ...UNEMPLOYMENT_EXAMPLE, ...overrides });
    return outcome.ok ? {} : outcome.errors;
  };

  it("rejects empty, zero and very large values", () => {
    expect(errors({ grossMonthly: NaN }).grossMonthly).toBe("required");
    expect(errors({ grossMonthly: 0 }).grossMonthly).toBe("tooSmall");
    expect(errors({ grossMonthly: 1e9 }).grossMonthly).toBe("tooLarge");
    expect(errors({ age: 15 }).age).toBe("tooSmall");
    expect(errors({ age: 71 }).age).toBe("tooLarge");
    expect(errors({ age: 30.5 }).age).toBe("whole");
    expect(errors({ years20: 21 }).years20).toBe("tooLarge");
    expect(errors({ dependants: -1 }).dependants).toBe("tooSmall");
  });

  it("flags contributions below the first row of the table", () => {
    expect(errors({ contributionMonths: 11 }).contributionMonths).toBe("belowTable");
    expect(errors({ contributionMonths: 12 }).contributionMonths).toBeUndefined();
  });
});
