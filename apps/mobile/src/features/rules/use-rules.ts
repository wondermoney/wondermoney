import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import {
  createRuleApplyCountEndpoint,
  createRuleApplyStartEndpoint,
  createRuleDeleteEndpoint,
  createRuleEndpoint,
  createRuleOperationEndpoint,
  createRuleUpdateEndpoint,
  dismissRuleSuggestionEndpoint,
  freezeRuleInput,
  rulePreviewEndpoint,
  rulesEndpoint,
  type RuleDraft,
  type RuleDto,
  type RuleInput,
  type RulePreview,
} from './rules-contract'

/** The household's rules, keyed by the auth epoch like every other read. */
export const rulesKey = (epochId: number) => ['rules', 'read', epochId] as const

export function useRules() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useRules requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: rulesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(rulesEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}

function useInvalidateRules() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Rule writes require an authenticated runtime')
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: rulesKey(runtime.epochId), exact: true })
}

/**
 * The preview of an unsaved rule. `draft` is null while the editor's rule is incomplete; pass an
 * already debounced value. Reads only, so its commit is a no-op.
 */
export function useRulePreview(draft: RuleDraft | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useRulePreview requires an authenticated runtime')
  return useQuery<RulePreview>({
    queryKey: [...rulesKey(runtime.epochId), 'preview', draft],
    queryFn: () => runtime.apiClient.write(rulePreviewEndpoint, { body: draft as RuleDraft, commit: () => undefined }),
    enabled: draft !== null,
    retry: false,
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

export function useCreateRule() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateRule requires an authenticated runtime')
  const invalidate = useInvalidateRules()
  return useMutation({
    retry: false,
    mutationFn: async (input: RuleInput): Promise<RuleDto> => {
      const { rule } = await runtime.apiClient.write(createRuleEndpoint, {
        body: freezeRuleInput(input),
        commit: () => { void invalidate() },
      })
      return rule
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

export function useUpdateRule() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useUpdateRule requires an authenticated runtime')
  const invalidate = useInvalidateRules()
  return useMutation({
    retry: false,
    mutationFn: async ({ ruleId, input }: { ruleId: number; input: RuleInput }): Promise<RuleDto> => {
      const { rule } = await runtime.apiClient.write(createRuleUpdateEndpoint(ruleId), {
        body: freezeRuleInput(input),
        commit: () => { void invalidate() },
      })
      return rule
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

/** The list's switch: only `active` is sent, so nothing else about the rule changes. */
export function useSetRuleActive() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useSetRuleActive requires an authenticated runtime')
  const invalidate = useInvalidateRules()
  return useMutation({
    retry: false,
    mutationFn: async ({ ruleId, active }: { ruleId: number; active: boolean }): Promise<RuleDto> => {
      const { rule } = await runtime.apiClient.write(createRuleUpdateEndpoint(ruleId), {
        body: { active },
        commit: () => { void invalidate() },
      })
      return rule
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

export function useDeleteRule() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDeleteRule requires an authenticated runtime')
  const invalidate = useInvalidateRules()
  return useMutation({
    retry: false,
    mutationFn: (ruleId: number) => runtime.apiClient.write(createRuleDeleteEndpoint(ruleId), {
      commit: () => { void invalidate() },
    }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

/**
 * How many of the household's existing transactions applying this rule now would change.
 * Writes nothing; the count is exactly what applying changes.
 */
export function useRuleApplyCount(ruleId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useRuleApplyCount requires an authenticated runtime')
  return useQuery<number>({
    queryKey: [...rulesKey(runtime.epochId), 'apply-count', ruleId],
    queryFn: async () => {
      const { changeCount } = await runtime.apiClient.write(createRuleApplyCountEndpoint(ruleId as number), {
        body: { dryRun: true },
        commit: () => undefined,
      })
      return changeCount
    },
    enabled: ruleId !== null,
    // Always the current count: it is what the person confirms.
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'partial', 'failed', 'needs_action', 'stale'])

export type RuleApplyFailure = 'in-progress' | 'demo' | 'read-only' | 'access' | 'failed' | 'general'

export type RuleApplyState =
  | { phase: 'idle' }
  | { phase: 'running' }
  /** Still going after the polling window: it finishes on its own. */
  | { phase: 'background' }
  | { phase: 'done'; changed: number }
  | { phase: 'error'; reason: RuleApplyFailure }

export type UseRuleApplyOptions = Readonly<{
  pollIntervalMs?: number
  maxPollAttempts?: number
  wait?: (ms: number) => Promise<void>
}>

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function classifyApplyFailure(error: unknown): RuleApplyFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'http' && error.status === 409) return 'in-progress'
  if (error.code === 'http' && error.status === 404) return 'failed'
  return 'general'
}

function changedFrom(progress: Record<string, unknown> | null | undefined): number {
  const changed = progress?.changed
  return typeof changed === 'number' && Number.isFinite(changed) ? changed : 0
}

/**
 * "Apply to existing transactions" after saving a rule: start the background run, follow its
 * operation to the end, then report how many transactions changed.
 */
export function useRuleApply(options: UseRuleApplyOptions = {}) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useRuleApply requires an authenticated runtime')
  const [state, setState] = useState<RuleApplyState>({ phase: 'idle' })
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const maxPollAttempts = options.maxPollAttempts ?? 60
  const wait = options.wait ?? defaultWait

  const start = useCallback(async (ruleId: number) => {
    setState({ phase: 'running' })
    try {
      const { operationId } = await runtime.apiClient.write(createRuleApplyStartEndpoint(ruleId), {
        body: { dryRun: false },
        commit: () => undefined,
      })
      for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        const operation = await runtime.apiClient.read(createRuleOperationEndpoint(operationId))
        if (TERMINAL_STATUSES.has(operation.status)) {
          if (operation.status === 'succeeded' || operation.status === 'partial') setState({ phase: 'done', changed: changedFrom(operation.progress) })
          else setState({ phase: 'error', reason: 'failed' })
          return
        }
        await wait(pollIntervalMs)
      }
      setState({ phase: 'background' })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
      setState({ phase: 'error', reason: classifyApplyFailure(error) })
    }
  }, [blockAccess, maxPollAttempts, pollIntervalMs, runtime, wait])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, start, reset }
}

/** "Don't suggest again" for a rule suggestion, by its fingerprint. Nothing to refresh after it. */
export function useDismissRuleSuggestion() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDismissRuleSuggestion requires an authenticated runtime')
  return useMutation({
    retry: false,
    mutationFn: async (fingerprint: string): Promise<void> => {
      await runtime.apiClient.write(dismissRuleSuggestionEndpoint, { body: { fingerprint }, commit: () => undefined })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
