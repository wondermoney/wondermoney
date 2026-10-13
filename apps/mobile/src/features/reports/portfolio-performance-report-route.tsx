import { type Href, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { mapPortfolioPerformanceReport } from './portfolio-performance-report-view-model'
import { PortfolioPerformanceReportScreen, type PortfolioPerformanceReportViewState } from './portfolio-performance-report-screen'
import { usePortfolioPerformanceReport } from './use-portfolio-performance-report'
import { useReportExport } from './use-report-export'
import { useReportFilterOptions } from './use-report-filter-options'
import { useReportFilters } from './use-report-filters'
import { useReportsCurrency } from './use-reports-currency'

export function PortfolioPerformanceReportRoute() {
  const router = useRouter()
  const filterState = useReportFilters()
  const filterOptions = useReportFilterOptions()
  const query = usePortfolioPerformanceReport(filterState.filters)
  const currencyCode = useReportsCurrency()
  const { state: exportState, exportCsv } = useReportExport('portfolio-performance', filterState.filters, new Date().toISOString().slice(0, 10))

  let state: PortfolioPerformanceReportViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    state = { status: 'loaded', report: mapPortfolioPerformanceReport(query.data), refreshing: query.isFetching }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  return (
    <PortfolioPerformanceReportScreen
      state={state}
      preset={filterState.preset}
      currencyCode={currencyCode}
      filterState={filterState}
      filterOptions={filterOptions}
      exportState={exportState}
      onSelectPreset={filterState.selectPreset}
      onExport={exportCsv}
      onRefresh={async () => { await query.refetch() }}
      onBack={() => router.replace('/reports' as unknown as Href)}
    />
  )
}
