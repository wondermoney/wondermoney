import { describe, expect, it } from "vitest";
import { computeIndexProjection, type IndexProjectionInput } from "./indexProjection";

const base: IndexProjectionInput = {
  principal: 10_000,
  monthlyContribution: 0,
  annualRate: 10,
  annualFee: 2,
  years: 1,
};

describe("index investment projection", () => {
  it("compounds the annual return, then accounts for the annual fee on the portfolio", () => {
    expect(computeIndexProjection(base)).toEqual({
      status: "ok", contributed: 10_000, beforeFees: 11_000, afterFees: 10_780, feeImpact: 220,
    });
  });

  it("models a loss and a fee independently", () => {
    expect(computeIndexProjection({ ...base, annualRate: -10 })).toMatchObject({
      status: "ok", beforeFees: 9_000, afterFees: 8_820, feeImpact: 180,
    });
  });

  it("adds deposits at month end, after that month's return", () => {
    expect(computeIndexProjection({
      ...base, principal: 0, monthlyContribution: 100, annualRate: 1.01 ** 12 * 100 - 100, annualFee: 0,
    })).toMatchObject({ status: "ok", contributed: 1200, beforeFees: 1268, afterFees: 1268, feeImpact: 0 });
  });

  it("handles zero amounts, rates and periods", () => {
    expect(computeIndexProjection({ ...base, principal: 0, annualRate: 0, annualFee: 0 }))
      .toMatchObject({ status: "ok", afterFees: 0, feeImpact: 0 });
    expect(computeIndexProjection({ ...base, monthlyContribution: 200, years: 0 }))
      .toMatchObject({ status: "ok", contributed: 10_000, afterFees: 10_000 });
  });

  it("gives a status instead of results for missing, out-of-range and overflowing scenarios", () => {
    expect(computeIndexProjection({ ...base, annualFee: NaN })).toEqual({ status: "incomplete" });
    expect(computeIndexProjection({ ...base, years: 1.5 })).toEqual({ status: "outOfRange" });
    expect(computeIndexProjection({ ...base, principal: Infinity })).toEqual({ status: "outOfRange" });
    expect(computeIndexProjection({ ...base, principal: 1e9, annualRate: 50, years: 60 }))
      .toEqual({ status: "tooLarge" });
  });
});
