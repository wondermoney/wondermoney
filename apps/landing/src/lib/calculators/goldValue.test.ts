import { describe, expect, it } from "vitest";
import { GOLD_PRICES, GOLD_PRICE_SOURCE } from "./data/goldPrice";
import {
  GOLD_LIMITS,
  GOLD_PURITIES,
  TROY_OUNCE_GRAMS,
  computeGoldValue,
  goldPriceSummary,
  goldValueExample,
  latestGoldPrice,
  type GoldPriceRow,
} from "./goldValue";
import { snapshotAgeDays } from "./snapshotAge";

const rows: GoldPriceRow[] = [
  ["2026-10-20", 500, 4.4, 113.6364],
  ["2026-11-12", 480, 4.4, 109.0909],
  ["2026-11-19", 484, 4.4, 110],
];

describe("gold price data", () => {
  it("is a dated, ordered snapshot of plausible same-day figures", () => {
    expect(GOLD_PRICE_SOURCE.asOf).toBe(GOLD_PRICES.at(-1)?.[0]);
    expect(GOLD_PRICE_SOURCE.fetchedOn >= GOLD_PRICE_SOURCE.asOf).toBe(true);
    const dates = GOLD_PRICES.map((row) => row[0]);
    expect([...dates].sort()).toEqual(dates);
    for (const [, pln, rate, eur] of GOLD_PRICES) {
      expect(eur).toBeCloseTo(pln / rate, 3);
      expect(eur).toBeGreaterThan(15);
      expect(eur).toBeLessThan(1_000);
    }
  });
});

describe("latestGoldPrice and goldPriceSummary", () => {
  it("reads the newest row and the change against the first and the previous row", () => {
    expect(latestGoldPrice(rows)).toEqual({ date: "2026-11-19", eurPerGram: 110, eurPerOunce: 110 * TROY_OUNCE_GRAMS });
    const summary = goldPriceSummary(rows);
    expect(summary.previousDate).toBe("2026-11-12");
    expect(summary.dayChangePercent).toBeCloseTo((110 / 109.0909 - 1) * 100, 6);
    expect(summary.firstDate).toBe("2026-10-20");
    expect(summary.periodChangePercent).toBeCloseTo((110 / 113.6364 - 1) * 100, 6);
  });
});

describe("computeGoldValue", () => {
  const base = { grams: 10, purity: "k19_2" as const, price: 110, offer: Number.NaN };

  it("values grams times fineness times the price of pure gold, to the cent", () => {
    const outcome = computeGoldValue(base);
    expect(outcome).toEqual({ ok: true, result: { pureGrams: 8, value: 880, offerShare: null, offerGap: null } });
  });

  it("knows the six legal finenesses, 24k at 999 thousandths and Portuguese gold at 800", () => {
    expect(GOLD_PURITIES.map((purity) => [purity.id, purity.karat, purity.fineness])).toEqual([
      ["k24", 24, 999],
      ["k22", 22, 916],
      ["k19_2", 19.2, 800],
      ["k18", 18, 750],
      ["k14", 14, 585],
      ["k9", 9, 375],
    ]);
    const value = (purity: (typeof GOLD_PURITIES)[number]["id"]) => {
      const outcome = computeGoldValue({ ...base, purity, grams: 100, price: 100 });
      return outcome.ok ? outcome.result.value : null;
    };
    expect(value("k24")).toBe(9_990);
    expect(value("k9")).toBe(3_750);
  });

  it("compares an offer with the metal value", () => {
    const outcome = computeGoldValue({ ...base, offer: 660 });
    if (!outcome.ok) throw new Error("expected a result");
    expect(outcome.result.offerShare).toBeCloseTo(75, 10);
    expect(outcome.result.offerGap).toBe(220);
  });

  it("gives zero for zero grams and no share of a zero value", () => {
    const outcome = computeGoldValue({ ...base, grams: 0, offer: 50 });
    expect(outcome).toEqual({ ok: true, result: { pureGrams: 0, value: 0, offerShare: null, offerGap: -50 } });
  });

  it("asks for a number, refuses negatives and caps very large entries", () => {
    expect(computeGoldValue({ ...base, grams: Number.NaN })).toEqual({ ok: false, errors: { grams: "required" } });
    expect(computeGoldValue({ ...base, grams: -1 })).toEqual({ ok: false, errors: { grams: "negative" } });
    expect(computeGoldValue({ ...base, grams: GOLD_LIMITS.grams + 1 })).toEqual({ ok: false, errors: { grams: "tooLarge" } });
    expect(computeGoldValue({ ...base, price: 0 })).toEqual({ ok: false, errors: { price: "zero" } });
    expect(computeGoldValue({ ...base, price: GOLD_LIMITS.price + 1 })).toEqual({ ok: false, errors: { price: "tooLarge" } });
    expect(computeGoldValue({ ...base, offer: -5 })).toEqual({ ok: false, errors: { offer: "negative" } });
    expect(computeGoldValue({ ...base, offer: GOLD_LIMITS.offer + 1 })).toEqual({ ok: false, errors: { offer: "tooLarge" } });
  });

  it("still values the largest accepted entry", () => {
    const outcome = computeGoldValue({ ...base, purity: "k24", grams: GOLD_LIMITS.grams, price: GOLD_LIMITS.price });
    if (!outcome.ok) throw new Error("expected a result");
    expect(outcome.result.value).toBe(GOLD_LIMITS.grams * 0.999 * GOLD_LIMITS.price);
    expect(Number.isFinite(outcome.result.value)).toBe(true);
  });

  it("starts the worked example at the latest price", () => {
    expect(goldValueExample()).toEqual({ grams: 10, purity: "k19_2", price: latestGoldPrice().eurPerGram, offer: Number.NaN });
  });
});

describe("snapshotAgeDays", () => {
  it("counts whole days from a date or a time to now", () => {
    const now = Date.parse("2026-11-22T10:00:00Z");
    expect(snapshotAgeDays("2026-11-19", now)).toBe(3);
    expect(snapshotAgeDays("2026-11-22T05:00Z", now)).toBe(0);
    expect(snapshotAgeDays("not a date", now)).toBe(0);
  });
});
