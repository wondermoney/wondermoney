import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { createAggregateMetricsEndpoint } from '@/features/account-insights/insights-contract'
import { aggregateMetricsKey } from '@/features/account-insights/query-keys'
import { useInsightQuery } from '@/features/account-insights/use-insight-query'

import { transactionsKey } from './query-keys'
import { createAggregateTransactionsEndpoint, type TransactionFilters } from './transactions-contract'

export type FigureState<T> = Readonly<{ status: 'loading' } | { status: 'error' } | { status: 'loaded'; value: T }>

export type TransactionsLeadData = Readonly<{
  flows: FigureState<{ moneyIn: number; moneyOut: number }>
  reviewCount: FigureState<number>
}>

/**
 * The figures above the all-accounts ledger, from the same endpoints web's
 * `TransactionsLead` reads: money in and out are the aggregate account metrics
 * over the date range (every account, whatever the filters), and the review
 * count is the server's total for unreviewed rows in that range.
 */
export function useTransactionsLead(range: Pick<TransactionFilters, 'fromDate' | 'toDate'>, enabled: boolean): TransactionsLeadData {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('The transactions lead requires an authenticated runtime')
  const scoped = Boolean(range.fromDate && range.toDate)
  const scope = { fromDate: range.fromDate ?? '', toDate: range.toDate ?? '' }
  const metrics = useInsightQuery(createAggregateMetricsEndpoint(scope), aggregateMetricsKey(runtime.epochId, scope), enabled && scoped)
  const reviewFilters: TransactionFilters = { fromDate: range.fromDate, toDate: range.toDate, needsReview: true }
  const review = useQuery({
    queryKey: transactionsKey(runtime.epochId, reviewFilters),
    queryFn: () => runtime.apiClient.read(createAggregateTransactionsEndpoint(reviewFilters)),
    enabled,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const flows: TransactionsLeadData['flows'] = !scoped
    ? { status: 'error' }
    : metrics.data
      ? {
          status: 'loaded',
          value: metrics.data.metrics.reduce(
            (sum, metric) => ({ moneyIn: sum.moneyIn + (metric.inflowCurrentPeriod ?? 0), moneyOut: sum.moneyOut + (metric.outflowCurrentPeriod ?? 0) }),
            { moneyIn: 0, moneyOut: 0 },
          ),
        }
      : metrics.isError ? { status: 'error' } : { status: 'loading' }
  const reviewCount: TransactionsLeadData['reviewCount'] = review.data
    ? { status: 'loaded', value: review.data.total ?? review.data.transactions.filter((row) => row.transactionKey > 0).length }
    : review.isError ? { status: 'error' } : { status: 'loading' }
  return { flows, reviewCount }
}
