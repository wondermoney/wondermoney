import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { monthKeyOf, shiftMonthKey } from './month-comparison-months'
import { monthComparisonReportKey } from './query-keys'
import { conservativeReportQueryOptions, isAccessError, isInvalidResponse, useReportAccessErrors } from './query-state'
import { createMonthComparisonEndpoint, type ReportFilters } from './reports-contract'

/** This month against last month, the report's default pair. */
export function useMonthComparisonMonths() {
  const [base, setBase] = useState(() => monthKeyOf(new Date()))
  const [compare, setCompare] = useState(() => shiftMonthKey(monthKeyOf(new Date()), -1))
  return useMemo(() => ({ base, compare, setBase, setCompare }), [base, compare])
}

export function useMonthComparisonReport(filters: ReportFilters, months: { base: string; compare: string }) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useMonthComparisonReport requires an authenticated runtime')
  const scoped = useMemo(() => ({ ...filters, base: months.base, compare: months.compare }), [filters, months.base, months.compare])
  const query = useQuery({
    queryKey: monthComparisonReportKey(runtime.epochId, scoped),
    queryFn: () => runtime.apiClient.read(createMonthComparisonEndpoint(scoped)),
    ...conservativeReportQueryOptions,
  })
  const errors = useMemo(() => [query.error], [query.error])
  useReportAccessErrors(errors, blockAccess)
  const suppress = isAccessError(query.error) || isInvalidResponse(query.error)
  return {
    ...query,
    data: suppress ? undefined : query.data,
    isAccessTransition: isAccessError(query.error),
    isInvalidResponse: isInvalidResponse(query.error),
  }
}
