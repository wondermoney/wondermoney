type FormatCurrency = (
  value: number,
  currency?: string,
  options?: Intl.NumberFormatOptions,
) => string;

/**
 * A quote's price in the currency the security is listed in. The API sends a
 * null currency when it cannot tell (no listing found, or listings in more than
 * one currency); then the price is the bare number, never a guessed symbol.
 * An empty code makes `formatCurrency` format a plain number (and mask it the
 * same way under privacy mode).
 */
export function formatQuotePrice(
  formatCurrency: FormatCurrency,
  price: number,
  currency: string | null,
): string {
  return currency
    ? formatCurrency(price, currency)
    : formatCurrency(price, "", { minimumFractionDigits: 2 });
}
