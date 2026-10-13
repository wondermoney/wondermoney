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
