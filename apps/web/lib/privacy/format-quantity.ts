import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";

import { AMOUNT_MASK } from "./mask";

/**
 * How many units of an asset someone holds or traded, or the mask while
 * privacy mode is on. A quantity times the asset's public price is the
 * position's value, so it is hidden like money: the same fixed mask, never one
 * dot per digit. Components use it through `useFormatQuantity()`.
 *
 * Wire decimals arrive as strings; anything that does not parse shows as-is
 * when visible (it carries no more than the API sent) and masked when hidden.
 */
export function formatQuantityForDisplay(
  value: number | string,
  locale: string,
  { hidden, ...options }: Intl.NumberFormatOptions & { hidden: boolean },
): string {
  if (hidden) return AMOUNT_MASK;
  const quantity = typeof value === "number" ? value : Number(value);
  if (
    typeof value === "string" &&
    (value.trim() === "" || !Number.isFinite(quantity))
  ) {
    return value;
  }
  return new Intl.NumberFormat(normalizeFinancialLocale(locale), {
    maximumFractionDigits: 8,
    ...options,
  }).format(quantity);
}
