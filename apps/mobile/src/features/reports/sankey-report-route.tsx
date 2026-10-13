import { type Href, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { mapSankeyReport } from './sankey-report-view-model'
import { SankeyReportScreen, type SankeyReportViewState } from './sankey-report-screen'
import { useReportExport } from './use-report-export'
import { useReportFilterOptions } from './use-report-filter-options'
import { useReportFilters } from './use-report-filters'
import { useReportsCurrency } from './use-reports-currency'
import { useSankeyReport } from './use-sankey-report'

export function SankeyReportRoute() {
  const router = useRouter()
  const filterState = useReportFilters()
  const filterOptions = useReportFilterOptions()
  const query = useSankeyReport(filterState.filters)
  const currencyCode = useReportsCurrency()
  const { state: exportState, exportCsv } = useReportExport('sankey', filterState.filters, new Date().toISOString().slice(0, 10))

  let state: SankeyReportViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    state = { status: 'loaded', report: mapSankeyReport(query.data), refreshing: query.isFetching }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  return (
    <SankeyReportScreen
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
