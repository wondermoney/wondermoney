import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  amountToUnits,
  decimalToUnits,
  fillRemainder,
  formatUnitsForInput,
  parseSplitLineAmount,
  type SplitDraftLine,
  splitEvenly,
  summarizeSplit,
  toSplitRequest,
  unitsToDecimal,
} from "./transaction-split";

const line = (
  amount: string,
  categoryKey: string | null = "1",
  notes = "",
): SplitDraftLine => ({ id: amount, amount, categoryKey, notes });

const units = (decimal: string) => decimalToUnits(decimal)!;

describe("units", () => {
  test("round-trip four decimals without float error", () => {
    assert.equal(units("-12.5"), -125000n);
    assert.equal(unitsToDecimal(-125000n), "-12.5");
    assert.equal(unitsToDecimal(units("0.0001")), "0.0001");
    assert.equal(decimalToUnits("1.00001"), null);
    assert.equal(amountToUnits(0.1 + 0.2), 3000n);
    assert.equal(amountToUnits(-100), -1000000n);
  });

  test("an input value is the magnitude in the reader's format", () => {
    assert.equal(formatUnitsForInput(units("-1234.5"), "pt-PT"), "1234,5");
    assert.equal(formatUnitsForInput(units("-1234.5"), "en"), "1234.5");
  });
});

describe("parseSplitLineAmount", () => {
  const total = units("-100");

  test("takes the transaction's sign from a typed magnitude", () => {
    assert.deepEqual(parseSplitLineAmount("60", total, "en"), {
      units: units("-60"),
      error: null,
    });
    assert.deepEqual(parseSplitLineAmount("40", units("100"), "en"), {
      units: units("40"),
      error: null,
    });
  });

  test("reads the number in the reader's locale", () => {
    assert.equal(
      parseSplitLineAmount("1.234,56", units("-2000"), "pt-PT").units,
      units("-1234.56"),
    );
    assert.equal(
      parseSplitLineAmount("12,5", total, "pt-PT").units,
      units("-12.5"),
    );
    // "1.000" is a thousand to a pt reader and one to an en reader.
    assert.equal(
      parseSplitLineAmount("1.000", units("-5000"), "pt-PT").units,
      units("-1000"),
    );
    assert.equal(
      parseSplitLineAmount("1.000", units("-5000"), "en").units,
      units("-1"),
    );
  });

  test("works a percentage out to the cent", () => {
    assert.equal(parseSplitLineAmount("25%", total, "en").units, units("-25"));
    assert.equal(
      parseSplitLineAmount("33,3 %", units("-10"), "pt-PT").units,
      units("-3.33"),
    );
  });

  test("blank is not an error yet; garbage, zero and five decimals are", () => {
    assert.deepEqual(parseSplitLineAmount("  ", total, "en"), {
      units: null,
      error: null,
    });
    assert.equal(parseSplitLineAmount("abc", total, "en").error, "invalid");
    assert.equal(parseSplitLineAmount("0", total, "en").error, "zero");
    assert.equal(parseSplitLineAmount("0%", total, "en").error, "zero");
    assert.equal(
      parseSplitLineAmount("1.00001", total, "en").error,
      "too-precise",
    );
  });
});

describe("summarizeSplit", () => {
  const total = units("-100");

  test("lines that add up exactly can be saved", () => {
    const summary = summarizeSplit(
      [line("33.33"), line("33.33"), line("33.34")],
      total,
      "en",
    );
    assert.equal(summary.remainingUnits, 0n);
    assert.equal(summary.problem, null);
  });

  test("reports what is left to assign, signed like the total", () => {
    const summary = summarizeSplit([line("60"), line("")], total, "en");
    assert.equal(summary.remainingUnits, units("-40"));
    assert.equal(summary.problem, "line-errors");

    const short = summarizeSplit([line("60"), line("30")], total, "en");
    assert.equal(short.remainingUnits, units("-10"));
    assert.equal(short.problem, "unassigned");
  });

  test("lines over the total are over-assigned", () => {
    const summary = summarizeSplit([line("100"), line("40")], total, "en");
    assert.equal(summary.remainingUnits, units("40"));
    assert.equal(summary.problem, "over-assigned");
  });

  test("a split needs two lines", () => {
    assert.equal(
      summarizeSplit([line("100")], total, "en").problem,
      "too-few-lines",
    );
  });

  test("an unreadable line blocks saving even when the rest add up", () => {
    const summary = summarizeSplit([line("100"), line("x")], total, "en");
    assert.equal(summary.problem, "line-errors");
  });
});

describe("splitEvenly", () => {
  test("shares out whole cents, leftovers on the first lines", () => {
    assert.deepEqual(splitEvenly(units("-100"), 3).map(unitsToDecimal), [
      "-33.34",
      "-33.33",
      "-33.33",
    ]);
    assert.deepEqual(splitEvenly(units("10"), 4).map(unitsToDecimal), [
      "2.5",
      "2.5",
      "2.5",
      "2.5",
    ]);
  });

  test("always adds up exactly, including below a cent", () => {
    for (const [total, count] of [
      ["-100.0005", 3],
      ["0.07", 3],
      ["-1234.56", 7],
    ] as const) {
      const lines = splitEvenly(units(total), count);
      assert.equal(lines.length, count);
      assert.equal(
        lines.reduce((sum, value) => sum + value, 0n),
        units(total),
      );
    }
  });
});

describe("fillRemainder", () => {
  const total = units("-100");

  test("adds what is left to the line", () => {
    assert.equal(fillRemainder(units("-60"), units("-40"), total), total);
    assert.equal(fillRemainder(null, units("-40"), total), units("-40"));
  });

  test("takes an over-assignment back off the line", () => {
    assert.equal(
      fillRemainder(units("-100"), units("40"), total),
      units("-60"),
    );
  });

  test("refuses to leave the line at zero or with the wrong sign", () => {
    assert.equal(fillRemainder(units("-40"), units("40"), total), null);
    assert.equal(fillRemainder(units("-10"), units("40"), total), null);
  });
});

test("toSplitRequest sends exact decimals, ids and trimmed notes", () => {
  const lines = [line("60", "7", " Food "), line("40", null)];
  const summary = summarizeSplit(lines, units("-100"), "en");
  assert.deepEqual(toSplitRequest(lines, summary), [
    { amount: "-60", categoryId: 7, notes: "Food" },
    { amount: "-40", categoryId: null, notes: null },
  ]);
});
