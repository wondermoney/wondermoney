import {
  decimalSeparatorForLocale,
  parseDecimalNumber,
} from "@wondermoney/shared/decimal";
import { z } from "zod";

/**
 * Reads a number the user typed, in their locale: "1.234,56" is 1234.56 everywhere, and
 * "1.000" is 1000 for a pt or es reader but 1 for an en reader. Returns null for anything
 * that is not unambiguously a number, so the form can say so instead of saving another
 * figure. The rules live in `@wondermoney/shared/decimal`, shared with mobile and the
 * CSV parsers.
 */
export function parseLocaleNumber(value: string, locale: string): number | null {
  return parseDecimalNumber(value, { locale });
}

/**
 * A stored number written back into a text field, with the locale's decimal separator and
 * no grouping, so editing it and reading it back gives the same figure: 1.234 is shown to a
 * pt reader as "1,234", never "1.234" (which they would mean as 1234).
 */
export function formatLocaleNumberInput(
  value: number | string | null | undefined,
  locale: string,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "";
  const plain = /e/i.test(String(value))
    ? value.toFixed(20).replace(/\.?0+$/, "")
    : String(value);
  return decimalSeparatorForLocale(locale) === ","
    ? plain.replace(".", ",")
    : plain;
}

/**
 * A decimal from the API ("1.234", always a dot) written into a text field for the user to
 * edit, with the locale's decimal separator. Shown raw, a pt reader would read "1.234" as
 * 1234. Text that is not a plain API decimal is returned unchanged.
 */
export function formatWireDecimalInput(
  value: string | number | null | undefined,
  locale: string,
): string {
  if (typeof value !== "string") return formatLocaleNumberInput(value, locale);
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return value;
  return decimalSeparatorForLocale(locale) === ","
    ? text.replace(".", ",")
    : text;
}

const isBlank = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");

function toNumber(
  value: string | number,
  locale: string,
  message: string,
  ctx: z.RefinementCtx,
): number {
  const parsed =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value
        : null
      : parseLocaleNumber(value, locale);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  }
  return parsed;
}

/**
 * A required number field typed in the user's locale. Blank or unreadable input is an error
 * carrying `message`; it never becomes 0 or another number.
 */
export function zLocaleNumber(locale: string, message: string) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx): number => toNumber(value, locale, message, ctx));
}

/** An optional number field typed in the user's locale: blank is undefined. */
export function zOptionalLocaleNumber(locale: string, message: string) {
  return z
    .union([z.string(), z.number(), z.undefined()])
    .transform((value, ctx): number | undefined =>
      isBlank(value)
        ? undefined
        : toNumber(value as string | number, locale, message, ctx),
    );
}
