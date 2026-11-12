import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { transactionsRootKey } from '@/features/transactions/query-keys'

import {
  createDeleteInstallmentPlanEndpoint,
  createInstallmentPlanEndpoint,
  installmentPlanCreateSchema,
  isValidInstallmentPlanId,
  type InstallmentPlanCreate,
} from './installments-contract'
import { installmentPlanDetailKey, installmentPlansRootKey } from './query-keys'

export type InstallmentWriteFailure = 'demo' | 'access' | 'invalid' | 'conflict' | 'not-found' | 'network' | 'general'

export function classifyInstallmentWriteFailure(error: unknown): InstallmentWriteFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'network' || error.code === 'cancelled') return 'network'
  if (error.code === 'http' && error.status === 400) return 'invalid'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'http' && error.status === 409) return 'conflict'
  return 'general'
}

/**
 * A plan changes what its card shows: the plans, the commitment, the suggestions (a linked row is
 * no longer one), the "n/N" badges in transaction lists and the card's forecast.
 */
function refreshAfterWrite(queryClient: QueryClient, epochId: number, accountId: number, deletedPlanId?: number) {
  void Promise.all([
    queryClient.invalidateQueries({
      queryKey: installmentPlansRootKey(epochId),
      // The deleted plan's own page is on its way out; refetching it would only flash "not found".
      predicate: deletedPlanId === undefined
        ? undefined
        : (query) => !matchesKey(query.queryKey, installmentPlanDetailKey(epochId, deletedPlanId)),
    }),
    queryClient.invalidateQueries({ queryKey: transactionsRootKey(epochId) }),
    queryClient.invalidateQueries({ queryKey: ['account', epochId, accountId, 'forecast'] }),
  ])
}

const matchesKey = (key: readonly unknown[], expected: readonly unknown[]) => (
  key.length === expected.length && key.every((part, index) => part === expected[index])
)

function useBlockOnMfa() {
  const { blockAccess } = useProductRuntime()
  return (error: unknown) => {
    if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
  }
}

/** `POST /v1/installment-plans`: a plan typed in, or a detected suggestion accepted with its links. */
export function useCreateInstallmentPlan() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useCreateInstallmentPlan requires an authenticated runtime')
  const queryClient = useQueryClient()
  const onError = useBlockOnMfa()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (value: InstallmentPlanCreate) => {
      const body = installmentPlanCreateSchema.parse(value)
      return runtime.apiClient.write(createInstallmentPlanEndpoint, {
        body,
        commit: () => refreshAfterWrite(queryClient, runtime.epochId, body.accountKey),
      })
    },
    onError,
  })
}

/** `DELETE /v1/installment-plans/:id`: the schedule goes, the posted transactions stay. */
export function useDeleteInstallmentPlan() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useDeleteInstallmentPlan requires an authenticated runtime')
  const queryClient = useQueryClient()
  const onError = useBlockOnMfa()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ planId, accountId }: { planId: number; accountId: number }) => {
      if (!isValidInstallmentPlanId(planId)) throw new Error('A positive safe installment plan id is required.')
      return runtime.apiClient.write(createDeleteInstallmentPlanEndpoint(planId), {
        commit: () => refreshAfterWrite(queryClient, runtime.epochId, accountId, planId),
      })
    },
    onError,
  })
}
