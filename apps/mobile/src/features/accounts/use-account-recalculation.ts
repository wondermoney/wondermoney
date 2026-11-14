import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { isManualTransactionAffectedQuery } from '@/features/transactions/use-create-manual-transaction'

import {
  type AccountRecalculationResult,
  createAccountRecalculationOperationEndpoint,
  createStartAccountRecalculationEndpoint,
  isTerminalOperationStatus,
  readAccountRecalculationResult,
} from './account-recalculation-contract'

export type AccountRecalculationFailure = 'too-soon' | 'demo' | 'read-only' | 'account-read-only' | 'access' | 'not-found' | 'network' | 'failed' | 'general'

export type AccountRecalculationState =
  | { phase: 'idle' }
  | { phase: 'running' }
  /** Still going after the polling window: it finishes on its own. */
  | { phase: 'background' }
  | { phase: 'done'; result: AccountRecalculationResult }
  | { phase: 'error'; reason: AccountRecalculationFailure }

function classifyFailure(error: unknown): AccountRecalculationFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'account-read-only') return 'account-read-only'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'network') return 'network'
  if (error.code === 'http' && error.status === 429) return 'too-soon'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  return 'general'
}

export type UseAccountRecalculationOptions = Readonly<{
  pollIntervalMs?: number
  maxPollAttempts?: number
  wait?: (ms: number) => Promise<void>
}>

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * "Recalculate balances" from the account screen, as web's account menu: start the background
 * rebuild, poll its operation to the end, then refresh everything an account's balances feed.
 */
export function useAccountRecalculation(options: UseAccountRecalculationOptions = {}) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAccountRecalculation requires an authenticated runtime')
  const queryClient = useQueryClient()
  const [state, setState] = useState<AccountRecalculationState>({ phase: 'idle' })
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const maxPollAttempts = options.maxPollAttempts ?? 60
  const wait = options.wait ?? defaultWait

  const start = useCallback(async (accountId: number) => {
    setState({ phase: 'running' })
    try {
      const { operationId } = await runtime.apiClient.write(createStartAccountRecalculationEndpoint(accountId), { commit: () => undefined })
      for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        const operation = await runtime.apiClient.read(createAccountRecalculationOperationEndpoint(operationId))
        if (isTerminalOperationStatus(operation.status)) {
          const result = operation.status === 'succeeded' ? readAccountRecalculationResult(operation.progress) : null
          void queryClient.invalidateQueries({ predicate: (query) => isManualTransactionAffectedQuery(query.queryKey, runtime.epochId) })
          setState(result ? { phase: 'done', result } : { phase: 'error', reason: 'failed' })
          return
        }
        await wait(pollIntervalMs)
      }
      setState({ phase: 'background' })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
      setState({ phase: 'error', reason: classifyFailure(error) })
    }
  }, [blockAccess, maxPollAttempts, pollIntervalMs, queryClient, runtime, wait])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, start, reset }
}
