import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

export function getAccountChartCurrencyCode(
  accountCurrencyCode: string,
  appuserCurrencyCode?: string,
): string {
  return appuserCurrencyCode ?? accountCurrencyCode;
}

export function getAccountsCashflowCurrencyCode(
  fallbackCurrencyCode: SupportedCurrencyCodes,
): SupportedCurrencyCodes {
  return fallbackCurrencyCode;
}
