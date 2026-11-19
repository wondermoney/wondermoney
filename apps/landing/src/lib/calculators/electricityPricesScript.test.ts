import { describe, expect, it } from "vitest";
import { deriveRows, renderModule } from "../../../scripts/build-electricity-prices.mjs";

/** A JSON-stat response shaped like Eurostat's: geo (EU, PT) by time (3 half-years), flat values. */
function response(overrides: Record<string, unknown> = {}) {
  const one = (key: string) => ({ category: { index: { [key]: 0 } } });
  return {
    version: "2.0",
    class: "dataset",
    updated: "2026-10-19T23:00:00+0200",
    id: ["freq", "siec", "nrg_cons", "unit", "tax", "currency", "geo", "time"],
    size: [1, 1, 1, 1, 1, 1, 2, 3],
    value: { 0: 0.15, 1: 0.16, 2: 0.17, 3: 0.2, 5: 0.22 }, // PT has no value for the second half-year
    dimension: {
      freq: one("S"),
      siec: one("E7000"),
      nrg_cons: one("KWH2500-4999"),
      unit: one("KWH"),
      tax: one("I_TAX"),
      currency: one("EUR"),
      geo: { category: { index: { EU27_2020: 0, PT: 1 } } },
      time: { category: { index: { "2020-S1": 0, "2020-S2": 1, "2021-S1": 2 } } },
    },
    ...overrides,
  };
}

describe("build-electricity-prices", () => {
  it("pairs Portugal and the EU by half-year and drops half-years missing either value", () => {
    // 12 half-years: EU cells 0-11, Portugal cells 12-23, with Portugal missing its fourth one (15).
    const periods = Array.from({ length: 12 }, (_, i) => `${2010 + Math.floor(i / 2)}-S${(i % 2) + 1}`);
    const value = Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => [i, i < 12 ? 0.2 + i / 100 : 0.1 + (i - 12) / 100]).filter(
        ([i]) => i !== 15,
      ),
    );
    const base = response();
    const rows = deriveRows({
      ...base,
      size: [1, 1, 1, 1, 1, 1, 2, 12],
      value,
      dimension: {
        ...base.dimension,
        time: { category: { index: Object.fromEntries(periods.map((p, i) => [p, i])) } },
      },
    });
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual({ period: "2010-S1", pt: 0.1, eu: 0.2 });
    expect(rows.find((row) => row.period === "2011-S2")).toBeUndefined();
    expect(rows.at(-1)?.period).toBe("2015-S2");
    expect(rows.at(-1)?.pt).toBeCloseTo(0.21, 10);
  });

  it("rejects a response that is not the expected cut", () => {
    expect(() => deriveRows({})).toThrow();
    expect(() => deriveRows(response())).toThrow(/Only 2 half-years/);
    const wrongBand = response();
    wrongBand.dimension.nrg_cons = { category: { index: { "KWH1000-2499": 0 } } };
    expect(() => deriveRows(wrongBand)).toThrow(/nrg_cons/);
  });

  it("renders a dated module with the source, version and every row", () => {
    const text = renderModule(
      [
        { period: "2025-S1", pt: 0.239, eu: 0.2879 },
        { period: "2025-S2", pt: 0.2435, eu: 0.2896 },
      ],
      { updatedOn: "2026-10-19", fetchedOn: "2026-11-19" },
    );
    expect(text).toContain('updatedOn: "2026-10-19"');
    expect(text).toContain('fetchedOn: "2026-11-19"');
    expect(text).toContain('["2025-S2", 0.2435, 0.2896],');
    expect(text).toContain('firstPeriod: "2025-S1"');
    expect(text).toContain("version: 1");
  });
});
