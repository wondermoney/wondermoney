import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { sankeyReportKey } from './query-keys'
import { conservativeReportQueryOptions, isAccessError, isInvalidResponse, useReportAccessErrors } from './query-state'
import { createSankeyEndpoint, type ReportFilters } from './reports-contract'

export function useSankeyReport(filters: ReportFilters) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useSankeyReport requires an authenticated runtime')
  const query = useQuery({
    queryKey: sankeyReportKey(runtime.epochId, filters),
    queryFn: () => runtime.apiClient.read(createSankeyEndpoint(filters)),
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
