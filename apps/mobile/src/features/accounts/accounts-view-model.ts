import type { AccountSource, AccountSummaryDto, AccountsResponseDto } from './accounts-contract'

export type AccountSummaryViewModel = Readonly<{
  accountId: number
  accountName: string | null
  institutionDisplayName: string | null
  isOwnedByViewer: boolean
  isPrivate: boolean
  originalBalance: number | null
  convertedBalance: number | null
  originalCurrencyCode: string
  primaryCurrencyCode: string
  refreshedAt: string | null
  source: AccountSource
}>

export const mapAccountSummary = (dto: AccountSummaryDto): AccountSummaryViewModel => ({
  accountId: dto.accountKey,
  accountName: dto.accountName,
  institutionDisplayName: dto.accountFinancialInstitutionKey?.displayName ?? null,
  isOwnedByViewer: dto.isOwnedByViewer,
  isPrivate: dto.isPrivate,
  originalBalance: dto.balance,
  convertedBalance: dto.appuserCurrencyBalance,
  originalCurrencyCode: dto.currencyKey.code,
  primaryCurrencyCode: dto.accountOwnerAppuserKey.currencyKey.code,
  refreshedAt: dto.refreshedAt,
  source: dto.source,
})

export const mapAccounts = (dto: AccountsResponseDto): readonly AccountSummaryViewModel[] => (
  dto.accounts.map(mapAccountSummary)
)
