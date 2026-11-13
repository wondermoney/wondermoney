import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { transactionsRootKey } from '@/features/transactions/query-keys'

import {
  createDeleteInstallmentPlanEndpoint,
  createInstallmentLinkEndpoint,
  createInstallmentPlanEndpoint,
  createInstallmentUnlinkEndpoint,
  installmentLinkBodySchema,
  installmentPlanCreateSchema,
  isValidInstallmentPlanId,
  type InstallmentPlanCreate,
} from './installments-contract'
import { installmentPlanDetailKey, installmentPlansRootKey } from './query-keys'

export type InstallmentWriteFailure = 'demo' | 'read-only' | 'access' | 'invalid' | 'conflict' | 'not-found' | 'network' | 'general'

export function classifyInstallmentWriteFailure(error: unknown): InstallmentWriteFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'network' || error.code === 'cancelled') return 'network'
  if (error.code === 'http' && error.status === 400) return 'invalid'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'http' && error.status === 409) return 'conflict'
  return 'general'
}

/** A refused link or unlink: a write failure, or one of the link endpoint's own reasons. */
export type InstallmentLinkFailure = InstallmentWriteFailure | 'pending' | 'expired' | 'transaction-linked' | 'installment-paid'

/** The link endpoint's reasons (`ERROR_CODE` in the API), by the code it answers with. */
const LINK_SERVER_FAILURES: Readonly<Record<string, InstallmentLinkFailure>> = {
  transaction_pending: 'pending',
  transaction_expired: 'expired',
  transaction_already_linked: 'transaction-linked',
  installment_already_paid: 'installment-paid',
}

/**
 * Why a link or unlink was refused. The endpoint names each reason: 400 `transaction_pending` (the
 * bank has not posted the charge yet) and `transaction_expired` (the bank dropped it), 409
 * `transaction_already_linked` and `installment_already_paid`. An older API answers with the generic
 * codes, so the status still decides then, as {@link classifyInstallmentWriteFailure} reads it.
 */
export function classifyInstallmentLinkFailure(error: unknown): InstallmentLinkFailure {
  if (error instanceof ApiError && error.code === 'http' && error.serverCode) {
    const known = LINK_SERVER_FAILURES[error.serverCode]
    if (known) return known
  }
  return classifyInstallmentWriteFailure(error)
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

/**
 * The message key (`installments.link.failures.*` or `installments.failures.*`) for a refused link
 * or unlink. A named reason has its own message; otherwise the status says why: 400 a transaction
 * on another card, 409 a transaction that already pays an installment (or an installment already
 * paid), 404 a plan or transaction that is gone.
 */
export function installmentLinkFailureMessage(failure: InstallmentLinkFailure, action: 'link' | 'unlink'): string {
  if (failure === 'pending') return 'installments.link.failures.pending'
  if (failure === 'expired') return 'installments.link.failures.expired'
  if (failure === 'transaction-linked') return 'installments.link.failures.transactionLinked'
  if (failure === 'installment-paid') return 'installments.link.failures.installmentPaid'
  if (failure === 'invalid') return action === 'link' ? 'installments.link.failures.wrongCard' : 'installments.link.failures.unlinkFailed'
  if (failure === 'conflict') return 'installments.link.failures.alreadyLinked'
  if (failure === 'not-found') return 'installments.link.failures.notFound'
  if (failure === 'general') return action === 'link' ? 'installments.link.failures.linkFailed' : 'installments.link.failures.unlinkFailed'
  return `installments.failures.${failure}`
}

/** A refusal that means the page was out of date, so the plan is refetched. */
const STALE_LINK_FAILURES: readonly InstallmentLinkFailure[] = ['conflict', 'transaction-linked', 'installment-paid', 'not-found']

type InstallmentRef = Readonly<{ planId: number; accountId: number; installmentNumber: number }>

/**
 * A link change answers with the plan as it now stands; it goes straight into the plan's page and
 * the same queries as any plan change refresh. A conflict or a missing row means this page was out
 * of date, so those refresh too.
 */
function useLinkWrite<Input extends InstallmentRef>(
  name: string,
  write: (input: Input) => { endpoint: ReturnType<typeof createInstallmentLinkEndpoint>; body?: unknown },
) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error(`${name} requires an authenticated runtime`)
  const queryClient = useQueryClient()
  const blockOnMfa = useBlockOnMfa()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (input: Input) => {
      const { endpoint, body } = write(input)
      return runtime.apiClient.write(endpoint, {
        body,
        commit: (result) => {
          queryClient.setQueryData(installmentPlanDetailKey(runtime.epochId, input.planId), result)
          refreshAfterWrite(queryClient, runtime.epochId, input.accountId)
        },
      })
    },
    onError: (error, input) => {
      blockOnMfa(error)
      if (STALE_LINK_FAILURES.includes(classifyInstallmentLinkFailure(error))) refreshAfterWrite(queryClient, runtime.epochId, input.accountId)
    },
  })
}

/** `POST /v1/installment-plans/:id/installments/:n/link`: a posted transaction pays installment `n`. */
export function useLinkInstallment() {
  return useLinkWrite('useLinkInstallment', (input: InstallmentRef & { transactionKey: number }) => ({
    endpoint: createInstallmentLinkEndpoint(input.planId, input.installmentNumber),
    body: installmentLinkBodySchema.parse({ transactionKey: input.transactionKey }),
  }))
}

/** `DELETE /v1/installment-plans/:id/installments/:n/link`: installment `n` is no longer paid. */
export function useUnlinkInstallment() {
  return useLinkWrite('useUnlinkInstallment', (input: InstallmentRef) => ({
    endpoint: createInstallmentUnlinkEndpoint(input.planId, input.installmentNumber),
  }))
}
