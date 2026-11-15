import { describe, expect, it } from "vitest";
import {
  formatNumericInput,
  isNumericDraft,
  parseNumericInput,
  sanitizeNumericInput,
  separatorOf,
  stepNumericValue,
} from "./numericInput";

describe("parseNumericInput", () => {
  it.each([
    ["3", 3],
    ["3.", 3],
    ["3.25", 3.25],
    ["3,25", 3.25],
    [",5", 0.5],
    ["-50", -50],
    ["+7", 7],
    ["007", 7],
    ["1 500", 1500],
    ["1\u00a0500,5", 1500.5],
    [" 12 ", 12],
  ])("reads %j as %d", (text, expected) => {
    expect(parseNumericInput(text)).toBe(expected);
  });

  it.each(["", " ", "-", "+", ".", ",", "-.", "-,"])("reads the partial entry %j as NaN", (text) => {
    expect(parseNumericInput(text)).toBeNaN();
  });

  it.each(["abc", "3a", "1.2.3", "1,00,0", "1,00.5", "1.000,000.5", "1e5", "--5", "5-"])(
    "reads the unreadable entry %j as NaN",
    (text) => {
      expect(parseNumericInput(text)).toBeNaN();
    },
  );

  describe("thousands separators", () => {
    const amount = { grouping: true };

    it.each([
      ["1,500", 1500],
      ["1.500", 1500],
      ["250,000", 250000],
      ["1,000,000", 1000000],
      ["1.000.000", 1000000],
      ["-1.500", -1500],
    ])("reads %j in an amount field as %d", (text, expected) => {
      expect(parseNumericInput(text, amount)).toBe(expected);
    });

    it.each([
      ["3,125", 3.125],
      ["1,500", 1.5],
      ["1.500", 1.5],
    ])("reads %j in a rate field as %d", (text, expected) => {
      expect(parseNumericInput(text)).toBe(expected);
    });

    it.each([
      ["1,000.50", 1000.5],
      ["1.000,50", 1000.5],
      ["1,000,000.25", 1000000.25],
      ["1.000.000,25", 1000000.25],
      ["1,000.", 1000],
    ])("reads %j with both marks as %d in any field", (text, expected) => {
      expect(parseNumericInput(text)).toBe(expected);
      expect(parseNumericInput(text, amount)).toBe(expected);
    });

    it.each([
      ["12,50", 12.5],
      ["1234,567", 1234.567],
      ["0,500", 0.5],
      ["1,5", 1.5],
    ])("reads %j in an amount field as a decimal, %d", (text, expected) => {
      expect(parseNumericInput(text, amount)).toBe(expected);
    });
  });

  it("reads an entry too large for a finite number as NaN", () => {
    expect(parseNumericInput("9".repeat(400))).toBeNaN();
  });
});

describe("isNumericDraft", () => {
  it.each(["", "-", "+", ".", ",", "3.", "3,", "3,25", "-0.5", "1 500", "1,000.5", "1.000,5"])("lets %j be typed", (text) => {
    expect(isNumericDraft(text)).toBe(true);
  });

  it.each(["a", "3a", "3..", "3.,", "--", "5-", "1e5", "€5"])("refuses %j", (text) => {
    expect(isNumericDraft(text)).toBe(false);
  });
});

describe("sanitizeNumericInput", () => {
  it.each([
    ["€1500", "1500"],
    ["1 500,00 €", "1 500,00 "],
    ["$ -2.5", " -2.5"],
    ["abc", ""],
  ])("keeps only what can be part of a number in %j", (text, expected) => {
    expect(sanitizeNumericInput(text)).toBe(expected);
  });
});

describe("formatNumericInput", () => {
  it("never writes an exponent", () => {
    expect(formatNumericInput(1e21)).toBe("1000000000000000000000");
    expect(formatNumericInput(1e-7)).toBe("0.0000001");
    expect(formatNumericInput(-0)).toBe("0");
  });

  it("shows NaN and infinities as an empty field", () => {
    expect(formatNumericInput(Number.NaN)).toBe("");
    expect(formatNumericInput(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("shows a number with the decimal mark asked for", () => {
    expect(formatNumericInput(3.25)).toBe("3.25");
    expect(formatNumericInput(3.25, ",")).toBe("3,25");
    expect(formatNumericInput(-50, ",")).toBe("-50");
  });
});

describe("separatorOf", () => {
  it("keeps the visitor's comma and defaults to a dot", () => {
    expect(separatorOf("3,25")).toBe(",");
    expect(separatorOf("3.25")).toBe(".");
    expect(separatorOf("")).toBe(".");
    expect(separatorOf("1,000.50")).toBe(".");
    expect(separatorOf("1.000,50")).toBe(",");
  });
});

describe("stepNumericValue", () => {
  it("steps up and down by step", () => {
    expect(stepNumericValue(10, 1, { step: 5 })).toBe(15);
    expect(stepNumericValue(10, -1, { step: 5 })).toBe(5);
  });

  it("stays within min and max", () => {
    expect(stepNumericValue(29.9, 1, { min: 0, max: 30, step: 0.5 })).toBe(30);
    expect(stepNumericValue(0.2, -1, { min: 0, max: 30, step: 0.5 })).toBe(0);
  });

  it("rounds to the step's precision", () => {
    expect(stepNumericValue(0.2, 1, { step: 0.1 })).toBe(0.3);
    expect(stepNumericValue(3.5, 1, { step: 0.05 })).toBe(3.55);
  });

  it("starts an empty field at min, or 0 without one", () => {
    expect(stepNumericValue(Number.NaN, 1, { min: 1, step: 1 })).toBe(1);
    expect(stepNumericValue(Number.NaN, -1, { step: 10 })).toBe(0);
  });
});
