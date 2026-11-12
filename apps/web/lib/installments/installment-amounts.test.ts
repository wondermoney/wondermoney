import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { installmentAmounts, installmentPreview } from "./installment-amounts";

const sumCents = (amounts: number[]) =>
  amounts.reduce((total, amount) => total + Math.round(amount * 100), 0);

describe("installmentAmounts", () => {
  test("splits evenly when the total divides into whole cents", () => {
    assert.deepEqual(installmentAmounts(1200, 12), Array(12).fill(100));
  });

  test("gives the rounding remainder to the last installment", () => {
    const amounts = installmentAmounts(100, 3);
    assert.deepEqual(amounts, [33.33, 33.33, 33.34]);
    assert.equal(sumCents(amounts), 10000);
  });

  test("the installments always add up to exactly the total", () => {
    for (const [total, count] of [
      [999.99, 7],
      [0.05, 2],
      [1234.56, 120],
      [10.01, 3],
      [49.9, 10],
    ] as const) {
      const amounts = installmentAmounts(total, count);
      assert.equal(amounts.length, count);
      assert.equal(
        sumCents(amounts),
        Math.round(total * 100),
        `${total}/${count}`,
      );
      // Every installment but the last is the same floor amount.
      assert.equal(new Set(amounts.slice(0, -1)).size, 1);
    }
  });

  test("returns nothing for inputs that are not a plan", () => {
    assert.deepEqual(installmentAmounts(0, 3), []);
    assert.deepEqual(installmentAmounts(-10, 3), []);
    assert.deepEqual(installmentAmounts(Number.NaN, 3), []);
    assert.deepEqual(installmentAmounts(100, 1), []);
    assert.deepEqual(installmentAmounts(100, 121), []);
    assert.deepEqual(installmentAmounts(100, 2.5), []);
  });
});

describe("installmentPreview", () => {
  test("names the regular and the last installment", () => {
    assert.deepEqual(installmentPreview(100, 3), {
      regular: 33.33,
      last: 33.34,
      count: 3,
    });
    assert.equal(installmentPreview(100, 1), null);
  });
});
