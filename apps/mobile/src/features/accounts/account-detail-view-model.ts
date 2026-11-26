import type { AccountSummaryDto } from './accounts-contract'
import { mapAccountSummary } from './accounts-view-model'

export type AccountDetailViewModel = ReturnType<typeof mapAccountSummary>

export const mapAccountDetail = (dto: AccountSummaryDto): AccountDetailViewModel => (
  mapAccountSummary(dto)
)

export function formatAccountFreshness(value: string | null, locale: string): string | null {
  if (!value) return null
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

/**
 * The date for "Balance as of …" under a bank account's balance while it is derived from the
 * transactions because the bank sent none (`balanceDerivedAt`): `refreshedAt`, the last time the
 * bank itself confirmed the balance. Null while the balance is the bank's own, or with no valid date.
 */
export function balanceAsOfDate(account: Pick<AccountDetailViewModel, 'balanceDerivedAt' | 'refreshedAt'>, locale: string): string | null {
  if (!account.balanceDerivedAt || !account.refreshedAt) return null
  const confirmedAt = new Date(account.refreshedAt)
  if (Number.isNaN(confirmedAt.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(confirmedAt)
}
