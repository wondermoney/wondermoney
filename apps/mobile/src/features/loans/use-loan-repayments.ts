import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createLoanRepaymentsEndpoint, isValidLoanId } from './loans-contract'
import { loanRepaymentsKey } from './query-keys'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

export function useLoanRepayments(loanId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useLoanRepayments requires an authenticated runtime')
  const valid = loanId !== null && isValidLoanId(loanId)
  return { ...useGuardedQuery(useQuery({
    queryKey: loanRepaymentsKey(runtime.epochId, loanId ?? 0),
    queryFn: () => runtime.apiClient.read(createLoanRepaymentsEndpoint(loanId!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })), isInvalidId: !valid }
}
