import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createLoanEndpoint, isValidLoanId } from './loans-contract'
import { loanKey } from './query-keys'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

export function useLoan(loanId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useLoan requires an authenticated runtime')
  const valid = loanId !== null && isValidLoanId(loanId)
  return { ...useGuardedQuery(useQuery({
    queryKey: loanKey(runtime.epochId, loanId ?? 0),
    queryFn: () => runtime.apiClient.read(createLoanEndpoint(loanId!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })), isInvalidId: !valid }
}
