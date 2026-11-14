import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createLoanProjectionEndpoint, isValidLoanId } from './loans-contract'
import { loanProjectionKey } from './query-keys'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

export function useLoanProjection(loanId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useLoanProjection requires an authenticated runtime')
  const valid = loanId !== null && isValidLoanId(loanId)
  return { ...useGuardedQuery(useQuery({
    queryKey: loanProjectionKey(runtime.epochId, loanId ?? 0),
    queryFn: () => runtime.apiClient.read(createLoanProjectionEndpoint(loanId!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })), isInvalidId: !valid }
}
