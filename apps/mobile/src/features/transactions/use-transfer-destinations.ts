import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { AccountSummaryDto } from '@/features/accounts/accounts-contract'
import { useGoals } from '@/features/goals/use-goals'
import { portfoliosEndpoint } from '@/features/portfolios/portfolios-contract'
import { portfoliosKey } from '@/features/portfolios/query-keys'
import { conservativePortfolioQueryOptions } from '@/features/portfolios/query-state'

import type { TransferDestinationOptions } from './transactions-screen'

/**
 * Where an outgoing transfer can be marked as going: the household's accounts (from the list the
 * caller already holds), its portfolios and its active goals. A list that fails to load is simply
 * not offered; the transfer itself never depends on it.
 */
export function useTransferDestinations(accounts: readonly AccountSummaryDto[] | undefined): TransferDestinationOptions {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTransferDestinations requires an authenticated runtime')
  const { t } = useTranslation()
  const portfolios = useQuery({
    queryKey: portfoliosKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(portfoliosEndpoint),
    ...conservativePortfolioQueryOptions,
  })
  const goals = useGoals()
  return {
    accounts: (accounts ?? []).map((account) => ({ key: account.accountKey, name: account.accountName ?? t('accounts.unnamed') })),
    portfolios: (portfolios.data?.portfolios ?? []).map((portfolio) => ({ key: portfolio.portfolioKey, name: portfolio.name })),
    goals: (goals.data?.goals ?? []).filter((goal) => goal.status === 'active').map((goal) => ({ key: goal.goalKey, name: goal.name })),
  }
}
