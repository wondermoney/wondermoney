import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { createGoalEndpoint, goalCreateWriteSchema, type GoalCreateWrite } from './goals-contract'
import { goalCreateUnknownKey, goalsKey } from './query-keys'

export type GoalCreateFailure = 'validation' | 'demo' | 'access' | 'mfa' | 'request' | 'cancelled' | 'unknown' | 'general'
export type GoalCreateUnknownGate = Readonly<{ payload: Readonly<GoalCreateWrite> }>

class GoalCreateBlockedError extends Error {
  constructor() {
    super('Goal creation is blocked after an unknown outcome for this session.')
    this.name = 'GoalCreateBlockedError'
  }
}

export function classifyGoalCreateFailure(error: unknown): GoalCreateFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'validation' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (isPostDispatchCancellation(error)) return 'unknown'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && (error.status ?? 0) >= 400 && (error.status ?? 0) < 500) return 'request'
  return 'general'
}

export function useGoalCreateUnknownGate(): GoalCreateUnknownGate | null {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useGoalCreateUnknownGate requires an authenticated runtime')
  const queryClient = useQueryClient()
  const key = goalCreateUnknownKey(runtime.epochId)
  useEffect(() => {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'goal-create-unknown' && query.queryKey[1] !== runtime.epochId,
    })
  }, [queryClient, runtime.epochId])
  const query = useQuery<GoalCreateUnknownGate | null>({
    queryKey: key,
    queryFn: () => Promise.resolve(null),
    enabled: false,
    gcTime: Infinity,
  })
  return query.data ?? null
}

export function useCreateGoal() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateGoal requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  const unknownGate = useGoalCreateUnknownGate()

  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: GoalCreateWrite) => {
      if (inFlight.current) throw new Error('Goal creation is already pending.')
      if (queryClient.getQueryData(goalCreateUnknownKey(runtime.epochId))) throw new GoalCreateBlockedError()
      const payload = Object.freeze(goalCreateWriteSchema.parse(input))
      inFlight.current = true
      try {
        try {
          return await runtime.apiClient.write(createGoalEndpoint, {
            body: payload,
            commit: () => { void queryClient.invalidateQueries({ queryKey: goalsKey(runtime.epochId), exact: true }) },
          })
        } catch (error) {
          if (classifyGoalCreateFailure(error) === 'unknown') {
            queryClient.setQueryData(goalCreateUnknownKey(runtime.epochId), Object.freeze({ payload }))
          }
          throw error
        }
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
  return { ...mutation, unknownGate }
}
