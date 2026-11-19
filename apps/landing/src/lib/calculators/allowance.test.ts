import { describe, expect, it } from "vitest";
import { computeAllowance, workedInYear, validateAllowance, ALLOWANCE_EXAMPLE, type AllowanceInput } from "./allowance";
import { computeWithholdingCents } from "./payroll";

const base: AllowanceInput = { ...ALLOWANCE_EXAMPLE };
const run = (patch: Partial<AllowanceInput>) => {
  const out = computeAllowance({ ...base, ...patch });
  if (!out.ok) throw new Error(JSON.stringify(out.errors));
  return out.result;
};

describe("computeAllowance", () => {
  it("withholds a lump-sum Christmas allowance on its own with the monthly table", () => {
    const r = run({});
    expect(r.total.grossCents).toBe(150_000);
    expect(r.total.withholdingCents).toBe(computeWithholdingCents(150_000, { region: "mainland", status: "single", dependants: 0 }));
    expect(r.total.socialSecurityCents).toBe(16_500);
    expect(r.total.netCents).toBe(150_000 - r.total.withholdingCents - 16_500);
    expect(r.twelfth).toBeNull();
    expect(r.holidayDays).toBeNull();
  });

  it("pays a full-year holiday allowance of one month's pay for 22 days", () => {
    const r = run({ kind: "holiday" });
    expect(r.total.grossCents).toBe(150_000);
    expect(r.holidayDays).toBe(22);
  });

  it("prorates the Christmas allowance by calendar days in the hiring year", () => {
    expect(run({ startDate: "2026-07-01" }).total.grossCents).toBe(Math.round((150_000 * 184) / 365));
    expect(run({ startDate: "2026-01-01" }).total.grossCents).toBe(150_000);
    expect(run({ startDate: "2025-03-10" }).total.grossCents).toBe(150_000);
    expect(run({ startDate: "2026-12-31" }).total.grossCents).toBe(Math.round(150_000 / 365));
  });

  it("gives 2 holiday days per complete month in the hiring year, capped at 20", () => {
    expect(workedInYear("2026-03-15").completeMonths).toBe(9);
    expect(workedInYear("2026-03-01").completeMonths).toBe(10);
    expect(run({ kind: "holiday", startDate: "2026-03-15" }).holidayDays).toBe(18);
    expect(run({ kind: "holiday", startDate: "2026-03-15" }).total.grossCents).toBe(Math.round((150_000 * 18) / 22));
    expect(run({ kind: "holiday", startDate: "2026-01-01" }).holidayDays).toBe(20);
    expect(run({ kind: "holiday", startDate: "2026-12-10" })).toMatchObject({ holidayDays: 0, total: { grossCents: 0, netCents: 0 } });
  });

  it("withholds each twelfth on its own and reports the monthly extra amount", () => {
    const r = run({ mode: "twelfths" });
    expect(r.twelfth).toMatchObject({ grossCents: 12_500, payments: 12 });
    const ctx = { region: "mainland", status: "single", dependants: 0 } as const;
    expect(r.twelfth!.withholdingCents).toBe(computeWithholdingCents(12_500, ctx));
    expect(r.total.grossCents).toBe(150_000);
    expect(r.total.withholdingCents).toBe(r.twelfth!.withholdingCents * 12);
    expect(r.total.netCents).toBe(150_000 - r.total.withholdingCents - r.total.socialSecurityCents);
    // A twelfth is far below the 920 exemption threshold: no IRS on it.
    expect(r.twelfth!.withholdingCents).toBe(0);
  });

  it("spreads the hiring-year allowance over the months worked", () => {
    const r = run({ mode: "twelfths", startDate: "2026-03-15" });
    expect(r.twelfth!.payments).toBe(10);
  });

  it("uses the dependants, status and region tables", () => {
    const ctx = { region: "madeira", status: "marriedOneEarner", dependants: 3 } as const;
    const r = run({ ...ctx, grossMonthly: 3000 });
    expect(r.total.withholdingCents).toBe(computeWithholdingCents(300_000, ctx));
  });
});

describe("validateAllowance", () => {
  it("rejects empty, zero, huge, fractional dependants and bad or future dates", () => {
    expect(validateAllowance({ ...base, grossMonthly: NaN }).grossMonthly).toBe("required");
    expect(validateAllowance({ ...base, grossMonthly: 0 }).grossMonthly).toBe("tooSmall");
    expect(validateAllowance({ ...base, grossMonthly: 1e9 }).grossMonthly).toBe("tooLarge");
    expect(validateAllowance({ ...base, dependants: 1.5 }).dependants).toBe("whole");
    expect(validateAllowance({ ...base, startDate: "2026-02-30" }).startDate).toBe("invalidDate");
    expect(validateAllowance({ ...base, startDate: "2027-01-02" }).startDate).toBe("afterYear");
    expect(validateAllowance({ ...base, startDate: "" })).toEqual({});
  });
  it("returns errors instead of a result", () => {
    expect(computeAllowance({ ...base, grossMonthly: 0 }).ok).toBe(false);
  });
});
