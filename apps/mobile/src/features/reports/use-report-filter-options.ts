import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAccounts } from '@/features/accounts/use-accounts'
import { useCategories } from '@/features/categories/use-categories'
import type { HouseholdMembersModel } from '@/features/household/member-attribution'
import { useHouseholdMembers } from '@/features/household/use-household-members'

import { deriveAvailableCurrencies, mapAccountFilterOptions, mapCategoryFilterOptions, mapMerchantFilterOptions, type ReportFilterOption } from './report-filter-options'
import { useReportMerchants } from './use-report-merchants'

/** Bundles the four filter-option data sources the report filter panel needs. Each is
 * independently loaded (no blocking on one another) and simply renders empty until ready — the
 * panel itself is a supplementary refinement, not core report content, so there's no dedicated
 * loading/error state here. */
export type ReportFilterOptions = Readonly<{
  accounts: readonly ReportFilterOption[]
  categories: readonly ReportFilterOption[]
  merchants: readonly ReportFilterOption[]
  currencies: readonly string[]
  /** The household, for the member filter; absent reads as one member (no filter shown). */
  members?: HouseholdMembersModel
}>

export function useReportFilterOptions(): ReportFilterOptions {
  const { t } = useTranslation()
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()
  const merchantsQuery = useReportMerchants()
  // The member filter shows only in a household of more than one.
  const members = useHouseholdMembers()

  const accounts = useMemo(
    () => mapAccountFilterOptions(accountsQuery.data?.accounts ?? [], t('reports.filters.unknownAccount')),
    [accountsQuery.data, t],
  )
  const categories = useMemo(
    () => (categoriesQuery.data ? mapCategoryFilterOptions(categoriesQuery.data, t) : []),
    [categoriesQuery.data, t],
  )
  const merchants = useMemo(
    () => mapMerchantFilterOptions(merchantsQuery.data?.transactionMerchants ?? []),
    [merchantsQuery.data],
  )
  const currencies = useMemo(
    () => deriveAvailableCurrencies(accountsQuery.data?.accounts ?? []),
    [accountsQuery.data],
  )

  return { accounts, categories, merchants, currencies, members }
}
