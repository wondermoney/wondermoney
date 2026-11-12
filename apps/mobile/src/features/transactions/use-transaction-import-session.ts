import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import {
  createCancelTransactionImportEndpoint,
  createCommitTransactionImportEndpoint,
  createDecideTransactionImportRowsEndpoint,
  createMapTransactionImportAccountsEndpoint,
  createParseTransactionImportEndpoint,
  type KnownTransactionImportRowStatus,
  readTransactionImportSessionEndpoint,
  type TransactionImportDecision,
  type TransactionImportRowQuery,
  type TransactionImportSessionDto,
  type TransactionImportViewDto,
} from './transaction-import-contract'
import { applyRowDecisions, refetchIntervalFor } from './transaction-import-review-view-model'
import { classifyTransactionImportFailure, type TransactionImportFailure } from './use-transaction-import'

/** Every page and filter read of one session, under the sign-in it was read in. */
export const transactionImportSessionRootKey = (epochId: number, id: string) => ['transaction-import', epochId, id] as const
export const transactionImportSessionKey = (epochId: number, id: string, query: TransactionImportRowQuery) => (
  [...transactionImportSessionRootKey(epochId, id), { page: query.page, pageSize: query.pageSize, status: query.status ?? null }] as const
)

/**
 * One page of a staged import's rows and its summary (web's useTransactionImport): read again
 * every two seconds while the worker reads or writes, and not otherwise. A session that is gone
 * reads as not found (`isNotFound`), never retried.
 */
export function useTransactionImportSession(id: string, query: TransactionImportRowQuery) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionImportSession requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: transactionImportSessionKey(runtime.epochId, id, query),
    queryFn: () => runtime.apiClient.read(readTransactionImportSessionEndpoint(id, query)),
    placeholderData: keepPreviousData,
    refetchInterval: (state) => refetchIntervalFor(state.state.data?.session),
    retry: (failures, error) => failures < 2 && error instanceof ApiError && error.code === 'network',
  }))
}

export type TransactionImportReviewAction =
  | Readonly<{ type: 'decide'; decision: TransactionImportDecision; rowIds: readonly number[] }>
  | Readonly<{ type: 'decide-status'; decision: TransactionImportDecision; status: KnownTransactionImportRowStatus }>
  | Readonly<{ type: 'map'; mapping: Readonly<Record<string, number>> }>
  | Readonly<{ type: 'parse'; dateOrder?: 'day-first' | 'month-first' }>
  | Readonly<{ type: 'commit' }>
  | Readonly<{ type: 'cancel' }>

function request(id: string, action: TransactionImportReviewAction) {
  switch (action.type) {
    case 'decide':
      return { endpoint: createDecideTransactionImportRowsEndpoint(id), body: { decision: action.decision, rowIds: [...action.rowIds] } }
    case 'decide-status':
      return { endpoint: createDecideTransactionImportRowsEndpoint(id), body: { decision: action.decision, status: action.status } }
    case 'map':
      return { endpoint: createMapTransactionImportAccountsEndpoint(id), body: { mapping: { ...action.mapping } } }
    case 'parse':
      return { endpoint: createParseTransactionImportEndpoint(id), body: action.dateOrder ? { options: { dateOrder: action.dateOrder } } : {} }
    case 'commit':
      return { endpoint: createCommitTransactionImportEndpoint(id), body: undefined }
    case 'cancel':
      return { endpoint: createCancelTransactionImportEndpoint(id), body: undefined }
  }
}

/**
 * The review's writes on one session (web's useDecide/Map/Parse/Commit/CancelTransactionImport),
 * one at a time: while one is in flight the review takes no other, as on web. Each refreshes
 * every page of the session read so far; a row decision shows at once. A demo profile is
 * read-only: its first refused write locks the review's controls (`demoLocked`).
 */
export function useTransactionImportSessionActions(id: string) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionImportSessionActions requires an authenticated runtime')
  const queryClient = useQueryClient()
  const rootKey = transactionImportSessionRootKey(runtime.epochId, id)
  const [demoLocked, setDemoLocked] = useState(false)

  const mutation = useMutation({
    mutationFn: async (action: TransactionImportReviewAction): Promise<TransactionImportSessionDto> => {
      const { endpoint, body } = request(id, action)
      const response = await runtime.apiClient.write(endpoint, { body, commit: () => undefined })
      return response.session
    },
    onMutate: async (action) => {
      if (action.type !== 'decide') return
      await queryClient.cancelQueries({ queryKey: rootKey })
      queryClient.setQueriesData<TransactionImportViewDto>({ queryKey: rootKey }, (view) => (view ? applyRowDecisions(view, action.rowIds, action.decision) : view))
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
      if (error.code === 'demo-forbidden') setDemoLocked(true)
    },
    // The server is the truth: after a refused write too (the session may have expired meanwhile).
    onSettled: () => queryClient.invalidateQueries({ queryKey: rootKey }),
  })

  const { mutateAsync, reset } = mutation
  /** Resolves with the session as the write left it, or `null` when it failed (`failure` says why). */
  const run = useCallback(async (action: TransactionImportReviewAction): Promise<TransactionImportSessionDto | null> => {
    try {
      return await mutateAsync(action)
    } catch {
      return null
    }
  }, [mutateAsync])

  const failure: TransactionImportFailure | null = mutation.isError ? classifyTransactionImportFailure(mutation.error) : null
  return {
    run,
    pending: mutation.isPending,
    /** The write in flight, by kind ('commit' shows the commit button busy). */
    pendingAction: mutation.isPending ? mutation.variables?.type ?? null : null,
    failure,
    demoLocked,
    clearFailure: reset,
  }
}
