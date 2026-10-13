import { z } from "zod";

/**
 * Normalizes a locale-aware numeric string to a JS-parseable number string.
 * Handles comma as decimal separator (e.g. "12,50" -> "12.50")
 * and mixed thousand/decimal separators (e.g. "1.000,12" -> "1000.12").
 */
export function parseLocaleNumber(val: string): number {
  if (val.includes(".") && val.includes(",")) {
    const lastDotIndex = val.lastIndexOf(".");
    const lastCommaIndex = val.lastIndexOf(",");
    if (lastCommaIndex > lastDotIndex) {
      return Number(val.replace(/\./g, "").replace(/,/g, "."));
    }
    return Number(val.replace(/,/g, ""));
  }
  return Number(val.replace(/,/g, "."));
}

/**
 * Zod schema that coerces locale-aware numeric strings to numbers.
 * Use instead of z.coerce.number() for user-facing numeric inputs.
 */
export const zLocaleNumber = z
  .union([z.string(), z.number()])
  .transform((val): number => {
    if (typeof val === "string") return parseLocaleNumber(val);
    return val;
  });
