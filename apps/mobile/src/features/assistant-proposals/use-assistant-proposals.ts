import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useAiHiddenPreferenceState } from '@/features/preferences/use-ai-hidden'
import { transactionsRootKey } from '@/features/transactions/query-keys'
import { ApiError } from '@/lib/api/errors'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import {
  createProposalDecisionEndpoint,
  pendingProposalsEndpoint,
  type ProposalDecision,
  type ProposalDto,
} from './proposals-contract'

/** The pending proposals, keyed by the auth epoch like every other read. */
export const pendingProposalsKey = (epochId: number) => ['assistant-proposals', epochId, 'pending'] as const

/**
 * The person's pending proposals. Not fetched once they hid AI: the API refuses every proposal
 * route then, and the app shows no proposal surface.
 */
export function usePendingProposals() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('usePendingProposals requires an authenticated runtime')
  const preference = useAiHiddenPreferenceState()
  const aiHidden = preference.hidden
  const query = useGuardedQuery(useQuery({
    enabled: preference.known && !aiHidden,
    queryKey: pendingProposalsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(pendingProposalsEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
  return { ...query, aiHidden, isLoading: query.isLoading || !preference.known }
}

/**
 * The More row's badge. `available` is false until the AI preference is read, when AI is hidden,
 * or when the server predates proposals (its 404), so the row disappears instead of opening a
 * screen that cannot load. It stays shown
 * while the count loads or after another failure: the screen itself says what went wrong.
 */
export function usePendingProposalCount(): { available: boolean; count: number } {
  const { runtime } = useProductRuntime()
  const preference = useAiHiddenPreferenceState()
  const aiHidden = preference.hidden
  const query = useQuery({
    enabled: Boolean(runtime) && preference.known && !aiHidden,
    queryKey: pendingProposalsKey(runtime?.epochId ?? 0),
    queryFn: () => {
      if (!runtime) throw new Error('Proposals require an authenticated runtime')
      return runtime.apiClient.read(pendingProposalsEndpoint)
    },
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const error = query.error instanceof ApiError ? query.error : null
  const unsupported = error?.code === 'http' && error.status === 404
  return {
    available: Boolean(runtime) && preference.known && !aiHidden && !unsupported,
    count: query.data?.proposals.length ?? 0,
  }
}

/**
 * Why a decision did not go through, as the screen words it. `gone` is the API's 404 and 409s
 * (expired, already decided, or a transaction or category no longer there): the list is refetched
 * and the proposal leaves it.
 */
export type ProposalDecisionFailure = 'gone' | 'demo' | 'read-only' | 'general'

export function classifyProposalDecisionFailure(error: unknown): ProposalDecisionFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'http' && (error.status === 404 || error.status === 409)) return 'gone'
  return 'general'
}

/**
 * Apply or dismiss one proposal. After an apply the transaction lists, budgets and review counts
 * are stale, so they are invalidated with the proposals; after any failure the proposals are
 * refetched, since a 409 means the server's state moved on.
 */
export function useDecideProposal() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDecideProposal requires an authenticated runtime')
  const queryClient = useQueryClient()
  const invalidateProposals = () => queryClient.invalidateQueries({ queryKey: pendingProposalsKey(runtime.epochId), exact: true })
  return useMutation({
    retry: false,
    mutationFn: async ({ proposalId, decision }: { proposalId: number; decision: ProposalDecision }): Promise<ProposalDto> => {
      const { proposal } = await runtime.apiClient.write(createProposalDecisionEndpoint(proposalId, decision), {
        commit: () => {
          void invalidateProposals()
          if (decision === 'apply') {
            void queryClient.invalidateQueries({ queryKey: transactionsRootKey(runtime.epochId) })
            void queryClient.invalidateQueries({ queryKey: ['account-insights', runtime.epochId] })
            void queryClient.invalidateQueries({ queryKey: ['budgets', 'month', runtime.epochId] })
            void queryClient.invalidateQueries({ queryKey: ['recurring', runtime.epochId] })
          }
        },
      })
      return proposal
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
      void invalidateProposals()
    },
  })
}
