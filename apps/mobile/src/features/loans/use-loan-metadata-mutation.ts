import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { netWorthKey } from '@/features/net-worth/query-keys'
import { ApiError } from '@/lib/api/errors'

import { createLoanWriteEndpoint, loanWriteSchema, type LoanWrite } from './loans-contract'
import { loanKey, loansKey } from './query-keys'

export type LoanWriteFailure = 'demo' | 'access' | 'mfa' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid' | 'invalid-response' | 'general'

export function classifyLoanWriteFailure(error: unknown): LoanWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid-response'
  return 'general'
}

export function useLoanMetadataMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useLoanMetadataMutation requires an authenticated runtime')
  const queryClient = useQueryClient()
  const loanLocks = useRef(new Map<number, symbol>())
  const refreshRequired = useRef(new Set<number>())
  const [, setGuardVersion] = useState(0)
  const isLoanPending = useCallback((loanId: number) => loanLocks.current.has(loanId), [])
  const requiresAuthoritativeRefresh = useCallback((loanId: number) => refreshRequired.current.has(loanId), [])
  const markAuthoritativeRefresh = useCallback((loanId: number) => {
    if (refreshRequired.current.delete(loanId)) setGuardVersion((version) => version + 1)
  }, [])

  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async ({ loanId, value }: { loanId: number; value: LoanWrite }) => {
      if (loanLocks.current.has(loanId)) throw new Error('A change for this loan is already pending.')
      if (refreshRequired.current.has(loanId)) throw new ApiError('network')
      const lock = Symbol(`loan-${loanId}`)
      loanLocks.current.set(loanId, lock)
      setGuardVersion((version) => version + 1)
      try {
        const body = loanWriteSchema.parse(value)
        return await runtime.apiClient.write(createLoanWriteEndpoint(loanId), {
          body,
          commit: () => {
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: loansKey(runtime.epochId), exact: true }),
              queryClient.invalidateQueries({ queryKey: loanKey(runtime.epochId, loanId), exact: true }),
              queryClient.invalidateQueries({ queryKey: netWorthKey(runtime.epochId), exact: true }),
            ])
          },
        })
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'network' || error.code === 'invalid-response')) {
          refreshRequired.current.add(loanId)
          setGuardVersion((version) => version + 1)
        }
        throw error
      } finally {
        if (loanLocks.current.get(loanId) === lock) {
          loanLocks.current.delete(loanId)
          setGuardVersion((version) => version + 1)
        }
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })

  return { ...mutation, isLoanPending, requiresAuthoritativeRefresh, markAuthoritativeRefresh }
}
