import { describe, expect, it } from "vitest";

import {
  formatLocaleNumberInput,
  formatWireDecimalInput,
  parseLocaleNumber,
  zLocaleNumber,
  zOptionalLocaleNumber,
} from "./number";

const INVALID = "Invalid amount";

describe("parseLocaleNumber", () => {
  it.each([
    ["1.234,56", "pt", 1234.56],
    ["1.234,56", "es", 1234.56],
    ["1.234,56", "en", 1234.56],
    ["1,234.56", "en", 1234.56],
    ["1,234.56", "pt", 1234.56],
    ["1 234,56", "pt", 1234.56],
    ["1.000", "pt", 1000],
    ["1.000", "es", 1000],
    ["1.000", "en", 1],
    ["1,000", "en", 1000],
    ["1,000", "pt", 1],
    ["0,5", "en", 0.5],
    ["12,50", "pt", 12.5],
    ["-12,30", "es", -12.3],
    ["(12,30)", "pt", -12.3],
    ["€ 1.234,56", "pt", 1234.56],
  ])("%s in %s is %s", (input, locale, expected) => {
    expect(parseLocaleNumber(input, locale)).toBe(expected);
  });

  it.each(["", "abc", "1.2.3", "12,", "1,234,56"])(
    "rejects %j instead of guessing",
    (input) => {
      expect(parseLocaleNumber(input, "pt")).toBeNull();
    },
  );
});

describe("formatLocaleNumberInput", () => {
  it("writes a stored number back with the locale's decimal separator", () => {
    expect(formatLocaleNumberInput(1.234, "pt")).toBe("1,234");
    expect(formatLocaleNumberInput(1.234, "es")).toBe("1,234");
    expect(formatLocaleNumberInput(1.234, "en")).toBe("1.234");
    expect(formatLocaleNumberInput(-1234.5, "pt")).toBe("-1234,5");
    expect(formatLocaleNumberInput(1000, "pt")).toBe("1000");
  });

  it("round-trips through parseLocaleNumber in every locale", () => {
    for (const locale of ["en", "pt", "es"]) {
      for (const value of [1.234, 1234.567, 0.5, -12.3, 1000, 0.00012345]) {
        expect(
          parseLocaleNumber(formatLocaleNumberInput(value, locale), locale),
        ).toBe(value);
      }
    }
  });

  it("leaves text and blanks as they are", () => {
    expect(formatLocaleNumberInput("1.234,5", "pt")).toBe("1.234,5");
    expect(formatLocaleNumberInput(undefined, "pt")).toBe("");
    expect(formatLocaleNumberInput(null, "pt")).toBe("");
  });
});

describe("formatWireDecimalInput", () => {
  it("writes an API decimal string with the locale's decimal separator", () => {
    expect(formatWireDecimalInput("1.234", "pt")).toBe("1,234");
    expect(formatWireDecimalInput("1.234", "en")).toBe("1.234");
    expect(formatWireDecimalInput("-0.00012345", "es")).toBe("-0,00012345");
    expect(formatWireDecimalInput("12345678901234567890.5", "pt")).toBe(
      "12345678901234567890,5",
    );
    expect(formatWireDecimalInput(2.5, "pt")).toBe("2,5");
    expect(formatWireDecimalInput(null, "pt")).toBe("");
  });

  it("is read back as the same figure", () => {
    for (const locale of ["en", "pt", "es"]) {
      expect(parseLocaleNumber(formatWireDecimalInput("1.234", locale), locale)).toBe(1.234);
      expect(parseLocaleNumber(formatWireDecimalInput("1000", locale), locale)).toBe(1000);
    }
  });
});

describe("zLocaleNumber", () => {
  const schema = zLocaleNumber("pt", INVALID);

  it("parses the user's locale", () => {
    expect(schema.parse("1.234,56")).toBe(1234.56);
    expect(schema.parse("1.000")).toBe(1000);
    expect(zLocaleNumber("en", INVALID).parse("1.000")).toBe(1);
    expect(schema.parse(42.5)).toBe(42.5);
  });

  it("reports unreadable or blank input instead of saving another number", () => {
    for (const input of ["abc", "1.2.3", "", "   "]) {
      const result = schema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(INVALID);
    }
    expect(schema.safeParse(Number.NaN).success).toBe(false);
  });
});

describe("zOptionalLocaleNumber", () => {
  const schema = zOptionalLocaleNumber("es", INVALID);

  it("treats a blank field as no value", () => {
    expect(schema.parse("")).toBeUndefined();
    expect(schema.parse("  ")).toBeUndefined();
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("parses or rejects anything else", () => {
    expect(schema.parse("1.234,56")).toBe(1234.56);
    expect(schema.parse(3)).toBe(3);
    const result = schema.safeParse("12,,5");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INVALID);
  });
});
