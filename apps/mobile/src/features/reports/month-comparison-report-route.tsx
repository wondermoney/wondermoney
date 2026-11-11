import { type Href, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { mapMonthComparisonReport } from './month-comparison-report-view-model'
import { MonthComparisonReportScreen, type MonthComparisonReportViewState } from './month-comparison-report-screen'
import { useMonthComparisonMonths, useMonthComparisonReport } from './use-month-comparison-report'
import { useReportExport } from './use-report-export'
import { useReportFilterOptions } from './use-report-filter-options'
import { useReportFilters } from './use-report-filters'
import { useReportsCurrency } from './use-reports-currency'

export function MonthComparisonReportRoute() {
  const router = useRouter()
  const filterState = useReportFilters()
  const filterOptions = useReportFilterOptions()
  const months = useMonthComparisonMonths()
  const query = useMonthComparisonReport(filterState.filters, months)
  const currencyCode = useReportsCurrency()
  const { state: exportState, exportCsv } = useReportExport(
    'month-comparison',
    { ...filterState.filters, base: months.base, compare: months.compare },
    new Date().toISOString().slice(0, 10),
  )

  let state: MonthComparisonReportViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    state = { status: 'loaded', report: mapMonthComparisonReport(query.data), completeness: query.data.completeness, refreshing: query.isFetching }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  return (
    <MonthComparisonReportScreen
      state={state}
      preset={filterState.preset}
      currencyCode={currencyCode}
      months={months}
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
