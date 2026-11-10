import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";

/**
 * What a hidden figure shows: a fixed run of dots, never one per digit, so the
 * mask does not give away the order of magnitude either.
 */
export const AMOUNT_MASK = "•••••";

const isCurrencyCode = (currency: string | null | undefined) =>
  typeof currency === "string" && /^[A-Z]{3}$/.test(currency);

export type MaskPart = { type: "currency" | "mask" | "literal"; value: string };

const NUMBER_PARTS = new Set(["integer", "group", "decimal", "fraction"]);

/**
 * The mask in the shape the locale gives money: the currency symbol stays
 * where the locale puts it (`€•••••` in en, `••••• €` in pt); the figure and
 * its sign do not survive.
 */
export function maskMoneyParts(
  currency: string | null | undefined,
  locale: string | undefined,
): MaskPart[] {
  if (!isCurrencyCode(currency)) return [{ type: "mask", value: AMOUNT_MASK }];

  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat(normalizeFinancialLocale(locale), {
      style: "currency",
      currency: currency as string,
    }).formatToParts(1);
  } catch {
    return [{ type: "mask", value: AMOUNT_MASK }];
  }

  const out: MaskPart[] = [];
  for (const part of parts) {
    if (NUMBER_PARTS.has(part.type)) {
      if (out.at(-1)?.type !== "mask") {
        out.push({ type: "mask", value: AMOUNT_MASK });
      }
    } else if (part.type === "currency") {
      out.push({ type: "currency", value: part.value });
    } else if (part.type === "literal") {
      out.push({ type: "literal", value: part.value });
    }
  }
  return out;
}

export function maskMoney(
  currency: string | null | undefined,
  locale: string | undefined,
): string {
  return maskMoneyParts(currency, locale)
    .map((part) => part.value)
    .join("");
}
