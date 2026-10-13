import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createLoanRepaymentCandidatesEndpoint, isValidLoanId } from './loans-contract'
import { loanRepaymentCandidatesKey } from './query-keys'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

export function useLoanRepaymentCandidates(loanId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useLoanRepaymentCandidates requires an authenticated runtime')
  const valid = loanId !== null && isValidLoanId(loanId)
  return {
    ...useGuardedQuery(useQuery({
      queryKey: loanRepaymentCandidatesKey(runtime.epochId, loanId ?? 0),
      queryFn: () => runtime.apiClient.read(createLoanRepaymentCandidatesEndpoint(loanId!)),
      enabled: valid,
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })),
    isInvalidId: !valid,
  }
}
