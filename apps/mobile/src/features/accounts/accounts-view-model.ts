import type { AccountSource, AccountSummaryDto, AccountsResponseDto, CsvImportFormat } from './accounts-contract'

export type AccountSyncStaleness = 'fresh' | 'stale' | 'very_stale' | 'error' | 'unknown'

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
  /** `null` when the API doesn't report it (older servers). */
  csvImportFormat: CsvImportFormat | null
  /** Optional extras web shows; absent on older fixtures and APIs. */
  ownerFirstName?: string | null
  convertedAvailableBalance?: number | null
  syncStaleness?: AccountSyncStaleness | null
  lastSyncedAt?: string | null
  /** The institution's logo, the account's mark. */
  institutionLogoUrl?: string | null
  /** The API's type key ('CREDIT_CARD'); `null` when unset or not reported. */
  accountType?: string | null
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
  csvImportFormat: dto.csvImportFormat ?? null,
  ownerFirstName: dto.ownerFirstName ?? null,
  convertedAvailableBalance: dto.appuserCurrencyAvailableBalance ?? null,
  syncStaleness: dto.syncStatus?.staleness ?? null,
  lastSyncedAt: dto.syncStatus?.lastSyncedAt ?? null,
  institutionLogoUrl: dto.accountFinancialInstitutionKey?.logoUrl ?? null,
  accountType: dto.accountType ?? null,
})

export const mapAccounts = (dto: AccountsResponseDto): readonly AccountSummaryViewModel[] => (
  dto.accounts.map(mapAccountSummary)
)
