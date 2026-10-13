import { type Href, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { mapNetWorthHistoryReport } from './net-worth-history-report-view-model'
import { NetWorthHistoryReportScreen, type NetWorthHistoryReportViewState } from './net-worth-history-report-screen'
import { useNetWorthHistoryReport } from './use-net-worth-history-report'
import { useReportExport } from './use-report-export'
import { useReportFilterOptions } from './use-report-filter-options'
import { useReportFilters } from './use-report-filters'
import { useReportsCurrency } from './use-reports-currency'

export function NetWorthHistoryReportRoute() {
  const router = useRouter()
  const filterState = useReportFilters()
  const filterOptions = useReportFilterOptions()
  const query = useNetWorthHistoryReport(filterState.filters)
  const currencyCode = useReportsCurrency()
  const { state: exportState, exportCsv } = useReportExport('net-worth-history', filterState.filters, new Date().toISOString().slice(0, 10))

  let state: NetWorthHistoryReportViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    state = { status: 'loaded', report: mapNetWorthHistoryReport(query.data), refreshing: query.isFetching }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  return (
    <NetWorthHistoryReportScreen
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
