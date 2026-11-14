import { type Href, useRouter } from 'expo-router'
import { useMemo } from 'react'

import { effectiveMemberFilter } from '@/features/household/member-attribution'
import { useHouseholdMembers } from '@/features/household/use-household-members'
import { ApiError } from '@/lib/api/errors'

import { mapPortfolioPerformanceReport } from './portfolio-performance-report-view-model'
import { PortfolioPerformanceReportScreen, type PortfolioPerformanceReportViewState } from './portfolio-performance-report-screen'
import { usePortfolioPerformanceReport } from './use-portfolio-performance-report'
import { useReportExport } from './use-report-export'
import { useReportFilters } from './use-report-filters'
import { useReportsCurrency } from './use-reports-currency'

export function PortfolioPerformanceReportRoute() {
  const router = useRouter()
  const filterState = useReportFilters()
  // The member filter (households of more than one): the report keeps the chosen member's portfolios.
  const members = useHouseholdMembers()
  const memberFilter = effectiveMemberFilter(filterState.fields.member, members)
  // A choice that names nobody in the household any more reads as everyone, and sends nothing.
  const filters = useMemo(() => {
    if (memberFilter !== null) return filterState.filters
    const { memberKeys: _unused, ...rest } = filterState.filters
    return rest
  }, [filterState.filters, memberFilter])
  const query = usePortfolioPerformanceReport(filters)
  const currencyCode = useReportsCurrency()
  const { state: exportState, exportCsv } = useReportExport('portfolio-performance', filters, new Date().toISOString().slice(0, 10))

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
      exportState={exportState}
      onSelectPreset={filterState.selectPreset}
      onExport={exportCsv}
      onRefresh={async () => { await query.refetch() }}
      onBack={() => router.replace('/reports' as unknown as Href)}
      memberFilter={members.multiMember ? { model: members, value: memberFilter, onChange: filterState.setMember } : undefined}
    />
  )
}
