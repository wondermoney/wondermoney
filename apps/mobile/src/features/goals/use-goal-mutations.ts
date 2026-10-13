import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  createGoalAccountLinkEndpoint,
  createGoalAccountUnlinkEndpoint,
  createGoalArchiveEndpoint,
  createGoalAssignEndpoint,
  createGoalMetadataEndpoint,
  createGoalMoveOutEndpoint,
  createGoalRestoreEndpoint,
  goalMetadataWriteSchema,
  goalReserveWriteSchema,
  type GoalMetadataWrite,
} from './goals-contract'
import { archivedGoalsKey, goalActivityKey, goalDetailKey, goalsKey } from './query-keys'

export type GoalWriteFailure = 'demo' | 'access' | 'mfa' | 'not-found' | 'cancelled' | 'network-ambiguous' | 'invalid-response' | 'general'

export function classifyGoalWriteFailure(error: unknown): GoalWriteFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'invalid-response') return 'invalid-response'
  return 'general'
}

type GoalMutation =
  | { kind: 'metadata'; goalId: number; value: GoalMetadataWrite }
  | { kind: 'link'; goalId: number; accountId: number }
  | { kind: 'unlink'; goalId: number; accountId: number }
  | { kind: 'assign' | 'move-out'; goalId: number; amount: number }
  | { kind: 'archive' | 'restore'; goalId: number }

export function useGoalMutations() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useGoalMutations requires an authenticated runtime')
  const queryClient = useQueryClient()
  const goalLocks = useRef(new Map<number, symbol>())
  const unknownGoals = useRef(new Set<number>())
  const [, setLockVersion] = useState(0)
  const isGoalPending = useCallback((goalId: number) => goalLocks.current.has(goalId), [])
  const isGoalUnknown = useCallback((goalId: number) => unknownGoals.current.has(goalId), [])
  const isGoalWriteBlocked = useCallback((goalId: number) => goalLocks.current.has(goalId) || unknownGoals.current.has(goalId), [])
  const clearGoalUnknown = useCallback((goalId: number) => {
    if (!unknownGoals.current.delete(goalId)) return
    setLockVersion((version) => version + 1)
  }, [])

  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (mutation: GoalMutation) => {
      if (isGoalWriteBlocked(mutation.goalId)) throw new Error('Writes for this goal are currently blocked.')
      const lock = Symbol(`goal-${mutation.goalId}`)
      goalLocks.current.set(mutation.goalId, lock)
      setLockVersion((version) => version + 1)
      const commit = () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: goalsKey(runtime.epochId), exact: true }),
          queryClient.invalidateQueries({ queryKey: archivedGoalsKey(runtime.epochId), exact: true }),
          queryClient.invalidateQueries({ queryKey: goalDetailKey(runtime.epochId, mutation.goalId), exact: true }),
          queryClient.invalidateQueries({ queryKey: goalActivityKey(runtime.epochId, mutation.goalId), exact: true }),
        ])
      }
      try {
        if (mutation.kind === 'metadata') {
          const body = goalMetadataWriteSchema.parse(mutation.value)
          return await runtime.apiClient.write(createGoalMetadataEndpoint(mutation.goalId), { body, commit })
        }
        if (mutation.kind === 'link') {
          return await runtime.apiClient.write(createGoalAccountLinkEndpoint(mutation.goalId, mutation.accountId), {
            body: { accountKey: mutation.accountId },
            commit,
          })
        }
        if (mutation.kind === 'unlink') {
          return await runtime.apiClient.write(createGoalAccountUnlinkEndpoint(mutation.goalId, mutation.accountId), { commit })
        }
        if (mutation.kind === 'archive') {
          return await runtime.apiClient.write(createGoalArchiveEndpoint(mutation.goalId), { commit })
        }
        if (mutation.kind === 'restore') {
          return await runtime.apiClient.write(createGoalRestoreEndpoint(mutation.goalId), { commit })
        }
        // TS does not retain this narrowing to the last remaining union member across the
        // preceding early-return branches once `mutation` is also captured by `commit` above.
        const reserveMutation = mutation as { kind: 'assign' | 'move-out'; goalId: number; amount: number }
        const body = goalReserveWriteSchema.parse({ amount: reserveMutation.amount })
        const endpoint = reserveMutation.kind === 'assign' ? createGoalAssignEndpoint(reserveMutation.goalId) : createGoalMoveOutEndpoint(reserveMutation.goalId)
        return await runtime.apiClient.write(endpoint, { body, commit })
      } catch (error) {
        const reserveWrite = mutation.kind === 'assign' || mutation.kind === 'move-out'
        if (error instanceof ApiError && (error.code === 'network' || (reserveWrite && error.code === 'invalid-response'))) {
          unknownGoals.current.add(mutation.goalId)
          setLockVersion((version) => version + 1)
        }
        throw error
      } finally {
        if (goalLocks.current.get(mutation.goalId) === lock) {
          goalLocks.current.delete(mutation.goalId)
          setLockVersion((version) => version + 1)
        }
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })

  return { ...mutation, clearGoalUnknown, isGoalPending, isGoalUnknown, isGoalWriteBlocked }
}
