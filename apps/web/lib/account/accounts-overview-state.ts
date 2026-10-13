import { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

export function getAccountsCashflowFromDate(fromDate?: Date): Date | undefined {
  return fromDate;
}

export function getAccountsOverviewCurrencyCode(
  accountCurrencyCode?: string,
): SupportedCurrencyCodes {
  return (accountCurrencyCode as SupportedCurrencyCodes | undefined) ?? "EUR";
}
