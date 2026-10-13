import { type Href, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'

import { mapBudgetVsActualReport } from './budget-vs-actual-view-model'
import type { BudgetVsActualViewState } from './budget-vs-actual-screen'
import { mapCashflowReport } from './cashflow-report-view-model'
import type { CashflowReportViewState } from './cashflow-report-screen'
import { mapNetWorthHistoryReport } from './net-worth-history-report-view-model'
import type { NetWorthHistoryReportViewState } from './net-worth-history-report-screen'
import { mapPortfolioPerformanceReport } from './portfolio-performance-report-view-model'
import type { PortfolioPerformanceReportViewState } from './portfolio-performance-report-screen'
import { ReportsHubScreen } from './reports-hub-screen'
import { mapSankeyReport } from './sankey-report-view-model'
import type { SankeyReportViewState } from './sankey-report-screen'
import { mapSpendingByCategoryReport } from './spending-by-category-report-view-model'
import type { SpendingByCategoryReportViewState } from './spending-by-category-report-screen'
import { useBudgetVsActualReport } from './use-budget-vs-actual'
import { useCashflowReport } from './use-cashflow-report'
import { useNetWorthHistoryReport } from './use-net-worth-history-report'
import { usePortfolioPerformanceReport } from './use-portfolio-performance-report'
import { useReportExport } from './use-report-export'
import { useReportFilterOptions } from './use-report-filter-options'
import { useReportFilters } from './use-report-filters'
import { useReportsCurrency } from './use-reports-currency'
import { useSankeyReport } from './use-sankey-report'
import { useSpendingByCategoryReport } from './use-spending-by-category-report'

/** All six reports composed on one page (RAD audit — mobile linked each one
 * out to its own screen while web always showed them inline, the biggest
 * cross-platform IA gap found). One shared filter/date-range state drives
 * every section's query, matching web's single ReportFiltersBar; each
 * section keeps its own query, export, and refresh so one failing report
 * doesn't block the rest of the page. */
export function ReportsHubRoute() {
  const router = useRouter()
  const { t } = useTranslation()
  const filterState = useReportFilters()
  const filterOptions = useReportFilterOptions()
  const currencyCode = useReportsCurrency()
  const today = new Date().toISOString().slice(0, 10)
  const { filters } = filterState

  const sankeyQuery = useSankeyReport(filters)
  const sankeyExport = useReportExport('sankey', filters, today)
  const cashflowQuery = useCashflowReport(filters)
  const cashflowExport = useReportExport('cashflow', filters, today)
  const spendingQuery = useSpendingByCategoryReport(filters)
  const spendingExport = useReportExport('spending-by-category', filters, today)
  const netWorthQuery = useNetWorthHistoryReport(filters)
  const netWorthExport = useReportExport('net-worth-history', filters, today)
  const budgetQuery = useBudgetVsActualReport(filters)
  const budgetExport = useReportExport('budget-vs-actual', filters, today)
  const portfolioQuery = usePortfolioPerformanceReport(filters)
  const portfolioExport = useReportExport('portfolio-performance', filters, today)

  let sankeyState: SankeyReportViewState
  if (sankeyQuery.isAccessTransition) sankeyState = { status: 'access-transition' }
  else if (sankeyQuery.isLoading) sankeyState = { status: 'loading' }
  else if (sankeyQuery.data) sankeyState = { status: 'loaded', report: mapSankeyReport(sankeyQuery.data), refreshing: sankeyQuery.isFetching }
  else if (sankeyQuery.error instanceof ApiError && sankeyQuery.error.code === 'invalid-response') sankeyState = { status: 'invalid-response' }
  else sankeyState = { status: 'error' }

  let cashflowState: CashflowReportViewState
  if (cashflowQuery.isAccessTransition) cashflowState = { status: 'access-transition' }
  else if (cashflowQuery.isLoading) cashflowState = { status: 'loading' }
  else if (cashflowQuery.data) cashflowState = { status: 'loaded', report: mapCashflowReport(cashflowQuery.data), refreshing: cashflowQuery.isFetching }
  else if (cashflowQuery.error instanceof ApiError && cashflowQuery.error.code === 'invalid-response') cashflowState = { status: 'invalid-response' }
  else cashflowState = { status: 'error' }

  let spendingState: SpendingByCategoryReportViewState
  if (spendingQuery.isAccessTransition) spendingState = { status: 'access-transition' }
  else if (spendingQuery.isLoading) spendingState = { status: 'loading' }
  else if (spendingQuery.data) {
    spendingState = {
      status: 'loaded',
      report: mapSpendingByCategoryReport(spendingQuery.data, spendingQuery.priorData, t('reports.other')),
      trendReady: spendingQuery.priorReady,
      refreshing: spendingQuery.isFetching,
    }
  } else if (spendingQuery.error instanceof ApiError && spendingQuery.error.code === 'invalid-response') spendingState = { status: 'invalid-response' }
  else spendingState = { status: 'error' }

  let netWorthState: NetWorthHistoryReportViewState
  if (netWorthQuery.isAccessTransition) netWorthState = { status: 'access-transition' }
  else if (netWorthQuery.isLoading) netWorthState = { status: 'loading' }
  else if (netWorthQuery.data) netWorthState = { status: 'loaded', report: mapNetWorthHistoryReport(netWorthQuery.data), refreshing: netWorthQuery.isFetching }
  else if (netWorthQuery.error instanceof ApiError && netWorthQuery.error.code === 'invalid-response') netWorthState = { status: 'invalid-response' }
  else netWorthState = { status: 'error' }

  let budgetState: BudgetVsActualViewState
  if (budgetQuery.isAccessTransition) budgetState = { status: 'access-transition' }
  else if (budgetQuery.isLoading) budgetState = { status: 'loading' }
  else if (budgetQuery.data) budgetState = { status: 'loaded', report: mapBudgetVsActualReport(budgetQuery.data), refreshing: budgetQuery.isFetching }
  else if (budgetQuery.error instanceof ApiError && budgetQuery.error.code === 'invalid-response') budgetState = { status: 'invalid-response' }
  else budgetState = { status: 'error' }

  let portfolioState: PortfolioPerformanceReportViewState
  if (portfolioQuery.isAccessTransition) portfolioState = { status: 'access-transition' }
  else if (portfolioQuery.isLoading) portfolioState = { status: 'loading' }
  else if (portfolioQuery.data) portfolioState = { status: 'loaded', report: mapPortfolioPerformanceReport(portfolioQuery.data), refreshing: portfolioQuery.isFetching }
  else if (portfolioQuery.error instanceof ApiError && portfolioQuery.error.code === 'invalid-response') portfolioState = { status: 'invalid-response' }
  else portfolioState = { status: 'error' }

  const refreshing = [sankeyQuery, cashflowQuery, spendingQuery, netWorthQuery, budgetQuery, portfolioQuery].some((query) => query.isFetching)
  const refreshAll = async () => {
    await Promise.all([
      sankeyQuery.refetch(), cashflowQuery.refetch(), spendingQuery.refetch(),
      netWorthQuery.refetch(), budgetQuery.refetch(), portfolioQuery.refetch(),
    ])
  }

  return (
    <ReportsHubScreen
      preset={filterState.preset}
      filterState={filterState}
      filterOptions={filterOptions}
      onSelectPreset={filterState.selectPreset}
      refreshing={refreshing}
      onRefreshAll={refreshAll}
      onBack={() => router.replace('/more' as unknown as Href)}
      sankey={{ state: sankeyState, currencyCode, exportState: sankeyExport.state, onExport: sankeyExport.exportCsv, onRefresh: async () => { await sankeyQuery.refetch() } }}
      cashflow={{ state: cashflowState, currencyCode, exportState: cashflowExport.state, onExport: cashflowExport.exportCsv, onRefresh: async () => { await cashflowQuery.refetch() } }}
      spendingByCategory={{ state: spendingState, currencyCode, exportState: spendingExport.state, onExport: spendingExport.exportCsv, onRefresh: async () => { await spendingQuery.refetch() } }}
      netWorthHistory={{ state: netWorthState, currencyCode, exportState: netWorthExport.state, onExport: netWorthExport.exportCsv, onRefresh: async () => { await netWorthQuery.refetch() } }}
      budgetVsActual={{ state: budgetState, currencyCode, exportState: budgetExport.state, onExport: budgetExport.exportCsv, onRefresh: async () => { await budgetQuery.refetch() } }}
      portfolioPerformance={{ state: portfolioState, currencyCode, exportState: portfolioExport.state, onExport: portfolioExport.exportCsv, onRefresh: async () => { await portfolioQuery.refetch() } }}
    />
  )
}
