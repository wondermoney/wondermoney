import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { netWorthKey } from '@/features/net-worth/query-keys'
import { ApiError } from '@/lib/api/errors'

import { loanCreateEndpoint, loanCreateWriteSchema, type LoanCreateWrite } from './loans-contract'
import { loansKey } from './query-keys'

export type LoanCreateFailure = 'demo' | 'access' | 'mfa' | 'invalid' | 'invalid-response' | 'general'

export function classifyLoanCreateFailure(error: unknown): LoanCreateFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'invalid-response') return 'invalid-response'
  if (error.code === 'http' && error.status === 400) return 'invalid'
  return 'general'
}

export function useCreateLoan() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateLoan requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (value: LoanCreateWrite) => {
      const body = loanCreateWriteSchema.parse(value)
      return runtime.apiClient.write(loanCreateEndpoint, {
        body,
        commit: () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: loansKey(runtime.epochId), exact: true }),
            queryClient.invalidateQueries({ queryKey: netWorthKey(runtime.epochId), exact: true }),
          ])
        },
      })
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
