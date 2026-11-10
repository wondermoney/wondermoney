import { describe, expect, it } from "vitest";

import { parseGoalMoney } from "./form";

describe("parseGoalMoney", () => {
  it.each([
    ["1,234.56", "en", 1234.56],
    ["1.234,56", "en", 1234.56],
    ["1.234,56", "pt", 1234.56],
    ["1.234,56", "es", 1234.56],
    ["1234,56", "pt", 1234.56],
    ["1.000", "pt", 1000],
    ["1.000", "es", 1000],
    ["1.000", "en", 1],
    ["1,000", "en", 1000],
    ["3,5", "pt", 3.5],
    ["3.5", "pt", 3.5],
    ["1.2345", "en", 1.2345],
  ])("%s in %s is %s", (input, locale, expected) => {
    expect(parseGoalMoney(input, locale)).toBe(expected);
  });

  it.each(["", "  ", "abc", "1.2.3", "12,", "1,234,56"])(
    "rejects %j instead of guessing",
    (input) => {
      expect(Number.isNaN(parseGoalMoney(input, "pt"))).toBe(true);
    },
  );
});
