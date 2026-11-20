import { describe, expect, it } from "vitest";
import {
  ANNUAL_IRS_BRACKETS_2026,
  MEAL_ALLOWANCE_EXEMPT_PER_DAY_CENTS,
  NET_SALARY_EXAMPLE,
  PAYROLL_REGIONS,
  WITHHOLDING_TABLE_IDS,
  WITHHOLDING_TABLE_SETS,
  annualBracketTaxCents,
  computeNetSalary,
  computePensionWithholdingCents,
  computeWithholdingCents,
  findRowIndex,
  parcelaCents,
  selectWithholdingTableId,
  type NetSalaryInput,
} from "./payroll";

const single = { region: "mainland", status: "single", dependants: 0 } as const;

function net(overrides: Partial<NetSalaryInput> = {}) {
  const outcome = computeNetSalary({ ...NET_SALARY_EXAMPLE, ...overrides });
  if (!outcome.ok) throw new Error("expected a valid input");
  return outcome.result;
}

describe("withholding tables 2026", () => {
  it("has the dated, sourced tables for every region", () => {
    for (const region of PAYROLL_REGIONS) {
      const set = WITHHOLDING_TABLE_SETS[region];
      expect(set.year).toBe(2026);
      expect(set.effectiveFrom).toBe("2026-01-01");
      expect(set.act).toMatch(/Despacho/);
      expect(set.sourceUrl).toMatch(/^https:\/\//);
    }
    expect(WITHHOLDING_TABLE_SETS.mainland.act).toBe("Despacho n.º 233-A/2026, de 6 de janeiro");
  });

  it.each(PAYROLL_REGIONS)("is ordered, ends open and is continuous between rows in %s", (region) => {
    for (const id of WITHHOLDING_TABLE_IDS) {
      const { rows } = WITHHOLDING_TABLE_SETS[region].tables[id];
      expect(rows.at(-1)?.upToCents).toBeNull();
      expect(rows[0].rateBp).toBe(0);
      for (let i = 1; i < rows.length; i++) {
        const limit = rows[i - 1].upToCents;
        if (limit === null || i < 2) continue;
        expect(rows[i].upToCents === null || rows[i].upToCents! > limit).toBe(true);
        // The tax at a row limit is the same whichever of the two rows computes it, within a cent.
        const at = (row: (typeof rows)[number]) => (limit * row.rateBp) / 10_000 - parcelaCents(row, limit);
        expect(Math.abs(at(rows[i]) - at(rows[i - 1]))).toBeLessThan(2);
      }
    }
  });

  it("selects the table from the holder situation", () => {
    expect(selectWithholdingTableId("single", 0)).toBe("I");
    expect(selectWithholdingTableId("single", 2)).toBe("II");
    expect(selectWithholdingTableId("marriedTwoEarners", 0)).toBe("I");
    expect(selectWithholdingTableId("marriedTwoEarners", 2)).toBe("I");
    expect(selectWithholdingTableId("marriedOneEarner", 0)).toBe("III");
    expect(selectWithholdingTableId("marriedOneEarner", 3)).toBe("III");
  });

  it("includes row limits as inclusive upper bounds", () => {
    const table = WITHHOLDING_TABLE_SETS.mainland.tables.I;
    expect(findRowIndex(table, 92_000)).toBe(0);
    expect(findRowIndex(table, 92_001)).toBe(1);
    expect(findRowIndex(table, 5_000_000)).toBe(11);
  });
});

describe("computeWithholdingCents", () => {
  it("applies rate x R - parcela a abater on the mainland, table I", () => {
    expect(computeWithholdingCents(150_000, single)).toBe(16_817); // 24.10% x 1500 - 193.33
    expect(computeWithholdingCents(92_000, single)).toBe(0);
    expect(computeWithholdingCents(0, single)).toBe(0);
  });

  it("uses the transition formula in the first rows", () => {
    // 12.50% x 921 - 12.50% x 2.60 x (1273.85 - 921) = 0.45
    expect(computeWithholdingCents(92_100, single)).toBe(45);
  });

  it("matches the official effective rate at the row limits (table I, no dependants)", () => {
    const official: Array<[number, number]> = [[1042, 5.3], [1108, 7.2], [1819, 13.5], [2119, 16.0], [5547, 30.1], [20_221, 40.9]];
    for (const [limit, percent] of official) {
      const withholding = computeWithholdingCents(limit * 100, single);
      expect((withholding / (limit * 100)) * 100).toBeCloseTo(percent, 0);
    }
  });

  it("subtracts the dependant parcela per table", () => {
    expect(computeWithholdingCents(150_000, { ...single, dependants: 1 })).toBe(13_388); // table II, 34.29
    expect(computeWithholdingCents(150_000, { region: "mainland", status: "marriedTwoEarners", dependants: 2 })).toBe(12_531);
    expect(computeWithholdingCents(150_000, { region: "mainland", status: "marriedOneEarner", dependants: 0 })).toBe(9_418);
    expect(computeWithholdingCents(150_000, { region: "mainland", status: "marriedOneEarner", dependants: 1 })).toBe(5_132);
  });

  it("takes one percentage point off the rate from three dependants and never goes below zero", () => {
    // 23.10% x 1500 - 193.33 - 3 x 34.29
    expect(computeWithholdingCents(150_000, { ...single, dependants: 3 })).toBe(5_030);
    expect(computeWithholdingCents(100_000, { ...single, dependants: 6 })).toBe(0);
  });

  it("uses the Azores and Madeira tables", () => {
    expect(computeWithholdingCents(150_000, { ...single, region: "azores" })).toBe(10_322);
    expect(computeWithholdingCents(150_000, { ...single, region: "madeira" })).toBe(10_014);
    expect(computeWithholdingCents(98_000, { ...single, region: "madeira" })).toBe(0);
    expect(computeWithholdingCents(98_000, single)).toBeGreaterThan(0);
  });
});

describe("computeNetSalary", () => {
  it("computes the worked example: 1500 gross in 14 months with a cash meal allowance", () => {
    const { monthly, allowancePayment, annual } = net();
    expect(monthly).toMatchObject({
      taxableCents: 150_000, withholdingCents: 16_817, socialSecurityCents: 16_500,
      mealAllowanceCents: 13_530, mealExemptCents: 13_530, mealTaxableCents: 0, netCents: 130_213,
    });
    expect(allowancePayment).toMatchObject({ withholdingCents: 16_817, socialSecurityCents: 16_500, netCents: 116_683 });
    expect(annual.netCents).toBe(12 * 130_213 + 2 * 116_683);
    expect(annual.grossCents).toBe(12 * (150_000 + 13_530) + 2 * 150_000);
  });

  it("taxes only the meal allowance above the daily limit", () => {
    const cash = net({ mealDaily: 12 });
    expect(cash.monthly.mealExemptCents).toBe(615 * 22);
    expect(cash.monthly.mealTaxableCents).toBe(585 * 22);
    expect(cash.monthly.taxableCents).toBe(150_000 + 585 * 22);
    const card = net({ mealDaily: 12, mealKind: "card" });
    expect(card.monthly.mealTaxableCents).toBe(Math.round((1200 - MEAL_ALLOWANCE_EXEMPT_PER_DAY_CENTS.card) * 22));
    expect(card.monthly.mealTaxableCents).toBeLessThan(cash.monthly.mealTaxableCents);
    expect(net({ mealDaily: 0 }).monthly.mealAllowanceCents).toBe(0);
  });

  it("spreads the allowances over 12 payments when paid in twelfths", () => {
    const { monthly, allowancePayment, annual } = net({ allowances: "twelfths" });
    expect(allowancePayment).toBeNull();
    expect(monthly.taxableCents).toBe(175_000);
    expect(monthly.withholdingCents).toBe(22_842);
    expect(monthly.socialSecurityCents).toBe(19_250);
    expect(monthly.netCents).toBe(146_438);
    expect(annual.netCents).toBe(12 * 146_438);
  });

  it("is the sum of its parts", () => {
    const { monthly, allowancePayment, annual } = net({ grossMonthly: 2345.67, dependants: 2, status: "marriedOneEarner" });
    expect(monthly.netCents).toBe(
      monthly.taxableCents + monthly.mealExemptCents - monthly.withholdingCents - monthly.socialSecurityCents,
    );
    expect(annual.withholdingCents).toBe(12 * monthly.withholdingCents + 2 * allowancePayment!.withholdingCents);
    expect(annual.grossCents - annual.withholdingCents - annual.socialSecurityCents).toBe(annual.netCents);
  });

  it("rejects invalid input", () => {
    const bad = computeNetSalary({ ...NET_SALARY_EXAMPLE, grossMonthly: Number.NaN, dependants: 1.5, mealDays: 40, mealDaily: -1 });
    expect(bad).toEqual({
      ok: false,
      errors: { grossMonthly: "required", dependants: "whole", mealDays: "tooLarge", mealDaily: "tooSmall" },
    });
    expect(computeNetSalary({ ...NET_SALARY_EXAMPLE, grossMonthly: 0 }).ok).toBe(false);
  });
});

describe("annual IRS brackets 2026", () => {
  it("matches the average rates published with Decreto-Lei n.º 212/2026", () => {
    const average = (limit: number) => (annualBracketTaxCents(limit * 100) / (limit * 100)) * 100;
    expect(average(8342)).toBeCloseTo(12.2, 3);
    expect(average(12_587)).toBeCloseTo(13.212, 2);
    expect(average(17_838)).toBeCloseTo(15.416, 2);
    expect(average(43_090)).toBeCloseTo(24.732, 2);
    expect(average(86_634)).toBeCloseTo(34.658, 2);
  });

  it("charges the top rate above the last limit and nothing on zero", () => {
    expect(annualBracketTaxCents(0)).toBe(0);
    const last = ANNUAL_IRS_BRACKETS_2026[7].upToCents;
    expect(annualBracketTaxCents(last + 100_000) - annualBracketTaxCents(last)).toBe(48_000);
  });
});

describe("pension withholding (Despacho n.º 233-A/2026, table VIII)", () => {
  it("withholds nothing up to 920 euros", () => {
    expect(computePensionWithholdingCents(92_000)).toBe(0);
    expect(computePensionWithholdingCents(0)).toBe(0);
  });

  it("applies the transition rows with the R-dependent parcela", () => {
    // 12.5% x 1000 - 12.5% x 2.6 x (1320.92 - 1000) = 125 - 104.30
    expect(computePensionWithholdingCents(100_000)).toBe(2070);
    // Effective rate at the limit of the row is 3.8% (the table's own column).
    expect(computePensionWithholdingCents(104_200) / 104_200).toBeCloseTo(0.038, 3);
  });

  it("applies the fixed parcelas and the marginal rates of the higher rows", () => {
    expect(computePensionWithholdingCents(113_300)).toBe(6618); // 15.7% x 1133 - 111.70
    expect(computePensionWithholdingCents(150_000)).toBe(15_154); // 24.1% x 1500 - 209.96
    expect(computePensionWithholdingCents(200_000)).toBe(28_121); // 31.1% x 2000 - 340.79
    expect(computePensionWithholdingCents(2_000_000)).toBe(913_088); // 53% x 20000 - 1469.12
  });

  it("matches every row of table VIII as published in the Diário da República (Série II, n.º 3/2026, Suplemento)", () => {
    // [row limit in euros, marginal rate %, parcela a abater (euros, or [factor, ceiling] for rate x factor x (ceiling - R)),
    //  "taxa efetiva mensal de retenção no limite do escalão" in %], copied from the published annex.
    const official: [number, number, number | [number, number], number][] = [
      [1042, 12.5, [2.6, 1320.92], 3.8],
      [1100, 15.7, [1.35, 1627.01], 5.5],
      [1133, 15.7, 111.7, 5.8],
      [1239, 21.2, 174.02, 7.2],
      [1869, 24.1, 209.96, 12.9],
      [2114, 31.1, 340.79, 15.0],
      [2361, 34.9, 421.13, 17.1],
      [3462, 43.1, 614.74, 25.3],
      [5833, 44.6, 666.67, 33.2],
      [18_332, 50.5, 1010.82, 45.0],
    ];
    for (const [limit, rate, parcela, effective] of official) {
      const deduction = typeof parcela === "number" ? parcela : (rate / 100) * parcela[0] * (parcela[1] - limit);
      const withheld = computePensionWithholdingCents(limit * 100);
      expect(withheld).toBe(Math.round(limit * rate - deduction * 100)); // cents
      expect(Math.round((withheld / (limit * 100)) * 1000) / 10).toBe(effective);
    }
    // Above the last limit: 53% minus 1469.12.
    expect(computePensionWithholdingCents(1_833_201)).toBe(Math.round(18_332.01 * 53 - 146_912));
  });

  it("is lower than the same amount taxed as employment income (no Social Security either)", () => {
    expect(computePensionWithholdingCents(150_000)).toBeLessThan(computeWithholdingCents(150_000, single));
  });
});
