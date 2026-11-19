import { describe, expect, it } from "vitest";
import {
  PURCHASE_TAXES_EXAMPLE,
  PURCHASE_TAXES_LIMITS,
  computePurchaseTaxes,
  YOUNG_LIMITS,
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

  it("matches the parcela a abater of every table in Ofício Circulado 40129/2026", () => {
    const deducts = (use: "ownPermanent" | "secondary", region: "mainland" | "islands") =>
      imtBands(use, region).map((band) => band.deductCents / 100);
    expect(deducts("ownPermanent", "mainland").slice(0, 5)).toEqual([0, 2_126.92, 6_491.02, 10_457.96, 13_763.35]);
    expect(deducts("secondary", "mainland").slice(0, 5)).toEqual([0, 1_063.46, 5_427.56, 9_394.5, 12_699.89]);
    expect(deducts("ownPermanent", "islands").slice(0, 5)).toEqual([0, 2_658.66, 8_113.8, 13_072.48, 17_204.22]);
    expect(deducts("secondary", "islands").slice(0, 5)).toEqual([0, 1_329.33, 6_784.47, 11_743.15, 15_874.89]);
  });

  it("uses the published regional limits and the regional young tables", () => {
    expect(imtBands("ownPermanent", "islands").map((band) => band.upTo)).toEqual([
      132_933, 181_838, 247_934, 413_174, 826_228, 1_438_566, Infinity,
    ]);
    expect(imtBands("secondary", "islands")[4].upTo).toBe(792_414);
    expect(YOUNG_LIMITS("islands")).toEqual({ full: 413_174, partial: 826_228 });
    // Table IV: 8% of the value minus 17,204.22 above 413,174.
    expect(resultFor({ region: "islands", price: 500_000, loan: 0 }).imt).toBe(22_795.78);
    // Table VI: 7% minus 11,743.15 at 400,000.
    expect(resultFor({ region: "islands", use: "secondary", price: 400_000, loan: 0 }).imt).toBe(16_256.85);
  });

  it("taxes an own permanent home progressively, and stamp duty on the price and the loan", () => {
    expect(resultFor({ price: 200_000, loan: 0 })).toMatchObject({
      imt: 3_542.04, stampPurchase: 1_600, stampLoan: 0, total: 5_142.04,
    });
    expect(resultFor()).toMatchObject({
      imt: 7_042.04, stampPurchase: 2_000, stampLoan: 1_200, total: 10_242.04,
    });
  });

  it("is exempt below the first limit, deducts 13,763.35 from 8% above 330,539 and taxes 6% flat above 660,982", () => {
    expect(resultFor({ price: 106_346, loan: 0 }).imt).toBe(0);
    expect(resultFor({ price: 330_539, loan: 0 }).imt).toBe(12_679.77);
    expect(resultFor({ price: 400_000, loan: 0 }).imt).toBe(18_236.65);
    expect(resultFor({ price: 660_982, loan: 0 }).imt).toBe(39_115.21);
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
      exemption: "partial", imt: 5_556.88, stampPurchase: 555.69,
    });
    expect(resultFor({ young: true, price: 700_000, loan: 0 }).exemption).toBe("none");
    expect(resultFor({ young: true, price: 600_000, region: "islands", loan: 100_000 })).toMatchObject({
      exemption: "partial", imt: 14_946.08, stampPurchase: 1_494.61, stampLoan: 600,
    });
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
