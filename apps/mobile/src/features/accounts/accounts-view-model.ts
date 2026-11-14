import { type FxState, resolveFxState } from '@/lib/api/fx-status'

import type { AccountAttributionDto } from '@/features/household/member-attribution'

import type { AccountAccess, AccountSource, AccountSummaryDto, AccountsResponseDto, CreditCardSettingsDto, CsvImportFormat } from './accounts-contract'

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
  /** The card's cycle and limit; `null` when the account is not a credit card. */
  creditCard?: CreditCardSettingsDto | null
  /** Who the account's money is attributed to; `null` when the API doesn't say (older servers). */
  attribution?: AccountAttributionDto | null
  /**
   * How `convertedBalance` was converted. `missing`: there is none; show `originalBalance`, marked
   * "Not converted". `provisional`: an estimate at an older rate. Absent on older fixtures: exact.
   */
  fx?: FxState
  /** The caller's access (#95). `read` hides every edit action; absent on older fixtures: writable. */
  myAccess?: AccountAccess
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
  creditCard: dto.creditCard ?? null,
  myAccess: dto.myAccess,
  attribution: dto.attribution ?? null,
  fx: resolveFxState({
    fxStatus: dto.fxStatus,
    fxRateDate: dto.fxRateDate,
    converted: dto.appuserCurrencyBalance,
    original: dto.balance,
    fromCurrency: dto.currencyKey.code,
    toCurrency: dto.accountOwnerAppuserKey.currencyKey.code,
  }),
})

export const mapAccounts = (dto: AccountsResponseDto): readonly AccountSummaryViewModel[] => (
  dto.accounts.map(mapAccountSummary)
)
