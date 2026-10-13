export enum CurrencyCodeToSymbol {
  USD = "$",
  EUR = "€",
  GBP = "£",
  JPY = "¥",
  CAD = "$",
  CHF = "CHF",
  HUF = "Ft",
  CZK = "Kč",
}

export type SupportedCurrencyCodes = keyof typeof CurrencyCodeToSymbol;

export function getCurrencySymbol(
  currency: string,
  locale?: Intl.LocalesArgument,
): string {
  return (0)
    .toLocaleString(locale, {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
    .replace(/\d/g, "")
    .trim();
}
