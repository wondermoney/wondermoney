import type { TFunction } from 'i18next'

import type { AccountSummaryDto } from '@/features/accounts/accounts-contract'
import { displayCategoryName } from '@/features/categories/categories-view-model'
import type { CategoriesResponse, CategoryDto } from '@/features/categories/categories-contract'

import type { TransactionMerchant } from './report-merchants-contract'

export type ReportFilterOption = Readonly<{ id: string; label: string }>

export const mapAccountFilterOptions = (accounts: readonly AccountSummaryDto[], unknownLabel: string): readonly ReportFilterOption[] => (
  accounts.map((account) => ({ id: String(account.accountKey), label: account.accountName ?? unknownLabel }))
)

/** Flattens the category tree (parents + children) into one list, matching web's
 * getSelectableCategories — every category is independently filterable, not just top-level ones. */
export const mapCategoryFilterOptions = (response: CategoriesResponse, t: TFunction): readonly ReportFilterOption[] => {
  const flatten = (category: CategoryDto & { childCategory?: readonly CategoryDto[] }): ReportFilterOption[] => [
    { id: String(category.categoryKey), label: displayCategoryName(category, t) },
    ...(category.childCategory ?? []).flatMap(flatten),
  ]
  return response.categories.flatMap(flatten)
}

export const mapMerchantFilterOptions = (merchants: readonly TransactionMerchant[]): readonly ReportFilterOption[] => (
  merchants.map((merchant) => ({ id: String(merchant.transactionMerchantKey), label: merchant.name }))
)

/** The currencies available to filter by are the ones actually present across the user's own
 * accounts, not a fixed master list — matches web's CurrencySelect derivation. */
export const deriveAvailableCurrencies = (accounts: readonly AccountSummaryDto[]): readonly string[] => (
  [...new Set(accounts.map((account) => account.currencyKey.code))].sort()
)
