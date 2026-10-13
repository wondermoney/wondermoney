import { useAccounts } from '@/features/accounts/use-accounts'

/** Mirrors web's ReportsCurrencyContext: the user's primary currency, derived from the first
 * account's owner currency, defaulting to EUR when there are no accounts yet. */
export function useReportsCurrency(): string {
  const { data } = useAccounts()
  return data?.accounts[0]?.accountOwnerAppuserKey.currencyKey.code ?? 'EUR'
}
