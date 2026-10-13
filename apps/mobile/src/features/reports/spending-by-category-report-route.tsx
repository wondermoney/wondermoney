import { type Href, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'

import { mapSpendingByCategoryReport } from './spending-by-category-report-view-model'
import { SpendingByCategoryReportScreen, type SpendingByCategoryReportViewState } from './spending-by-category-report-screen'
import { useReportExport } from './use-report-export'
import { useReportFilterOptions } from './use-report-filter-options'
import { useReportFilters } from './use-report-filters'
import { useReportsCurrency } from './use-reports-currency'
import { useSpendingByCategoryReport } from './use-spending-by-category-report'

export function SpendingByCategoryReportRoute() {
  const router = useRouter()
  const { t } = useTranslation()
  const filterState = useReportFilters()
  const filterOptions = useReportFilterOptions()
  const query = useSpendingByCategoryReport(filterState.filters)
  const currencyCode = useReportsCurrency()
  const { state: exportState, exportCsv } = useReportExport('spending-by-category', filterState.filters, new Date().toISOString().slice(0, 10))

  let state: SpendingByCategoryReportViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    state = {
      status: 'loaded',
      report: mapSpendingByCategoryReport(query.data, query.priorData, t('reports.other')),
      trendReady: query.priorReady,
      refreshing: query.isFetching,
    }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  return (
    <SpendingByCategoryReportScreen
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
