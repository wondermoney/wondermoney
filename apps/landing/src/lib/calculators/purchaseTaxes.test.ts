import { describe, expect, it } from "vitest";
import {
  PURCHASE_TAXES_EXAMPLE,
  PURCHASE_TAXES_LIMITS,
  computePurchaseTaxes,
  imtBands,
  type PurchaseTaxesInput,
} from "./purchaseTaxes";

function resultFor(overrides: Partial<PurchaseTaxesInput> = {}) {
  const calculation = computePurchaseTaxes({ ...PURCHASE_TAXES_EXAMPLE, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

describe("purchase taxes (IMT and Imposto do Selo, 2026 table)", () => {
  it("derives the published parcela a abater", () => {
    const bands = imtBands("ownPermanent", "mainland");
    expect(bands[3].deductCents).toBe(1_045_796);
    expect(bands[1].deductCents).toBe(212_692);
    expect(imtBands("secondary", "mainland")[1].deductCents).toBe(106_346);
  });

  it("taxes an own permanent home progressively, and stamp duty on the price and the loan", () => {
    expect(resultFor({ price: 200_000, loan: 0 })).toMatchObject({
      imt: 3_542.04, stampPurchase: 1_600, stampLoan: 0, total: 5_142.04,
    });
    expect(resultFor()).toMatchObject({
      imt: 7_042.04, stampPurchase: 2_000, stampLoan: 1_200, total: 10_242.04,
    });
  });

  it("is exempt below the first limit and taxes the whole value at 8% above 330,539", () => {
    expect(resultFor({ price: 106_346, loan: 0 }).imt).toBe(0);
    expect(resultFor({ price: 330_539, loan: 0 }).imt).toBe(12_679.77);
    expect(resultFor({ price: 400_000, loan: 0 }).imt).toBe(32_000);
    expect(resultFor({ price: 1_000_000, loan: 0 }).imt).toBe(60_000);
    expect(resultFor({ price: 2_000_000, loan: 0 }).imt).toBe(150_000);
  });

  it("charges secondary homes from the first euro and rustic and other urban flat rates", () => {
    expect(resultFor({ use: "secondary", price: 100_000, loan: 0 }).imt).toBe(1_000);
    expect(resultFor({ use: "secondary", price: 200_000, loan: 0 }).imt).toBe(4_605.5);
    expect(resultFor({ use: "rustic", price: 50_000, loan: 0 }).imt).toBe(2_500);
    expect(resultFor({ use: "otherUrban", price: 50_000, loan: 0 }).imt).toBe(3_250);
  });

  it("uses limits 25% higher in the islands", () => {
    expect(resultFor({ region: "islands", price: 132_933, loan: 0 }).imt).toBe(0);
    expect(resultFor({ region: "islands", price: 200_000, loan: 0 }).imt)
      .toBeLessThan(resultFor({ price: 200_000, loan: 0 }).imt);
  });

  it("taxes the higher of price and tax value", () => {
    expect(resultFor({ price: 150_000, taxValue: 200_000, loan: 0 }))
      .toMatchObject({ reference: 200_000, imt: 3_542.04, stampPurchase: 1_600 });
  });

  it("applies the young-buyer exemption only on request and only for an own permanent home", () => {
    expect(resultFor({ young: true, loan: 0 })).toMatchObject({
      exemption: "full", imt: 0, stampPurchase: 0, youngSaving: 7_042.04 + 2_000,
    });
    expect(resultFor({ young: true })).toMatchObject({ stampLoan: 1_200, total: 1_200 });
    expect(resultFor({ young: false, loan: 0 }).exemption).toBe("none");
    expect(resultFor({ young: true, use: "secondary", loan: 0 }).exemption).toBe("none");
    expect(resultFor({ young: true, price: 400_000, loan: 0 })).toMatchObject({
      exemption: "partial", imt: 5_556.88, stampPurchase: 3_200,
    });
    expect(resultFor({ young: true, price: 700_000, loan: 0 }).exemption).toBe("none");
    expect(resultFor({ young: true, region: "islands", price: 400_000, loan: 0 }).exemption).toBe("full");
  });

  it("handles zero and rejects blank, negative, oversized and inconsistent amounts", () => {
    expect(resultFor({ price: 0, loan: 0 })).toMatchObject({ total: 0, effectiveRate: 0 });
    expect(computePurchaseTaxes({
      ...PURCHASE_TAXES_EXAMPLE,
      price: NaN,
      taxValue: -1,
      loan: PURCHASE_TAXES_LIMITS.loan + 1,
    })).toEqual({ ok: false, errors: { price: "required", taxValue: "negative", loan: "tooLarge" } });
    expect(computePurchaseTaxes({ ...PURCHASE_TAXES_EXAMPLE, loan: 300_000 }))
      .toEqual({ ok: false, errors: { loan: "loan" } });
  });
});
