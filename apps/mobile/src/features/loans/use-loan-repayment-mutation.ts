import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { isBudgetQueryForEpoch } from '@/features/budgets/query-keys'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { type FrozenRepaymentWrite, freezeRepaymentWrite } from './loan-repayment-allocation'
import {
  createDeleteLoanRepaymentEndpoint,
  createLinkLoanRepaymentEndpoint,
  createUpdateLoanRepaymentEndpoint,
} from './loans-contract'
import { loanKey, loanRepaymentCandidatesKey, loanRepaymentsKey, loansKey } from './query-keys'

export type RepaymentWriteFailure = 'demo' | 'access' | 'mfa' | 'cancelled' | 'not-found' | 'conflict' | 'invalid' | 'unknown' | 'general'

const repaymentAffectedInsightFamilies: ReadonlySet<unknown> = new Set(['metrics', 'account', 'cashflow', 'category-spending'])

export const isRepaymentDerivedQueryForEpoch = (queryKey: readonly unknown[], epochId: number): boolean => (
  (queryKey[0] === 'transactions' && queryKey[1] === epochId)
  || (queryKey[0] === 'account-insights' && queryKey[1] === epochId && repaymentAffectedInsightFamilies.has(queryKey[2]))
  || isBudgetQueryForEpoch(queryKey, epochId)
  || (queryKey.length === 2 && queryKey[0] === 'net-worth' && queryKey[1] === epochId)
)

export function classifyRepaymentWriteFailure(error: unknown): RepaymentWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'unknown' : 'cancelled'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'http' && error.status === 409) return 'conflict'
  if (error.code === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500) return 'invalid'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  return 'general'
}

export function useLoanRepaymentMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useLoanRepaymentMutation requires an authenticated runtime')
  const queryClient = useQueryClient()
  const locks = useRef(new Map<number, symbol>())
  const refreshRequired = useRef(new Set<number>())
  const [, setGuardVersion] = useState(0)
  const isLoanPending = useCallback((loanId: number) => locks.current.has(loanId), [])
  const requiresAuthoritativeRefresh = useCallback((loanId: number) => refreshRequired.current.has(loanId), [])
  const markAuthoritativeRefresh = useCallback((loanId: number) => {
    if (refreshRequired.current.delete(loanId)) setGuardVersion((version) => version + 1)
  }, [])

  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: FrozenRepaymentWrite) => {
      const write = freezeRepaymentWrite(input)
      if (locks.current.has(write.loanId)) throw new Error('A repayment change for this loan is already pending.')
      if (refreshRequired.current.has(write.loanId)) throw new Error('Refresh repayment history and candidates before making another change.')
      const lock = Symbol(`loan-repayment-${write.loanId}`)
      locks.current.set(write.loanId, lock)
      setGuardVersion((version) => version + 1)
      let refresh: Promise<void> | undefined
      try {
        const endpoint = write.type === 'link'
          ? createLinkLoanRepaymentEndpoint(write.loanId, write.transactionKey)
          : write.type === 'edit'
            ? createUpdateLoanRepaymentEndpoint(write.loanId, write.repaymentLinkId)
            : createDeleteLoanRepaymentEndpoint(write.loanId, write.repaymentLinkId)
        const result = await runtime.apiClient.write(endpoint, {
          ...(write.type === 'unlink' ? {} : { body: write.allocation }),
          commit: () => {
            refresh = Promise.all([
              queryClient.invalidateQueries({ queryKey: loansKey(runtime.epochId), exact: true }),
              queryClient.invalidateQueries({ queryKey: loanKey(runtime.epochId, write.loanId), exact: true }),
              queryClient.invalidateQueries({ queryKey: loanRepaymentsKey(runtime.epochId, write.loanId), exact: true }),
              queryClient.invalidateQueries({ queryKey: loanRepaymentCandidatesKey(runtime.epochId, write.loanId), exact: true }),
              queryClient.invalidateQueries({ predicate: (query) => isRepaymentDerivedQueryForEpoch(query.queryKey, runtime.epochId) }),
            ]).then(() => undefined)
          },
        })
        await refresh
        return result
      } catch (error) {
        if (classifyRepaymentWriteFailure(error) === 'unknown') {
          refreshRequired.current.add(write.loanId)
          setGuardVersion((version) => version + 1)
        }
        throw error
      } finally {
        if (locks.current.get(write.loanId) === lock) {
          locks.current.delete(write.loanId)
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
