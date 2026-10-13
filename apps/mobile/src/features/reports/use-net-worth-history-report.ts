import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { netWorthHistoryReportKey } from './query-keys'
import { conservativeReportQueryOptions, isAccessError, isInvalidResponse, useReportAccessErrors } from './query-state'
import { createNetWorthHistoryReportEndpoint, type ReportFilters } from './reports-contract'

export function useNetWorthHistoryReport(filters: ReportFilters) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useNetWorthHistoryReport requires an authenticated runtime')
  const query = useQuery({
    queryKey: netWorthHistoryReportKey(runtime.epochId, filters),
    queryFn: () => runtime.apiClient.read(createNetWorthHistoryReportEndpoint(filters)),
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
