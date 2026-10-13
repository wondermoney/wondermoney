import { useQueryClient } from '@tanstack/react-query'
import { useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { GoalCreateScreen } from './goal-create-screen'
import { createGoalDetailEndpoint, goalsEndpoint, type GoalCreateWrite } from './goals-contract'
import { goalDetailKey, goalsKey } from './query-keys'
import { classifyGoalCreateFailure, useCreateGoal, type GoalCreateFailure } from './use-create-goal'

export function GoalCreateRoute() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('GoalCreateRoute requires an authenticated runtime')
  const mutation = useCreateGoal()
  const queryClient = useQueryClient()
  const router = useRouter()
  const navigation = useNavigation()
  const submissionGate = useRef(false)
  const navigationLock = useRef(false)
  const navigationUnlocked = useRef(false)
  const detailFlight = useRef(false)
  const didNavigate = useRef(false)
  const unknownRefreshAttempted = useRef(false)
  const [failure, setFailure] = useState<GoalCreateFailure | null>(null)
  const [refreshingGoals, setRefreshingGoals] = useState(false)
  const [goalsRefreshFailed, setGoalsRefreshFailed] = useState(false)
  const [confirmedGoalId, setConfirmedGoalId] = useState<number | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'unavailable'>('idle')

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if ((navigationLock.current || mutation.isPending) && !navigationUnlocked.current) event.preventDefault()
  }), [mutation.isPending, navigation])

  const refreshGoals = async () => {
    if (refreshingGoals) return
    setRefreshingGoals(true)
    setGoalsRefreshFailed(false)
    try {
      await queryClient.invalidateQueries({ queryKey: goalsKey(runtime.epochId), exact: true, refetchType: 'all' })
      await queryClient.fetchQuery({
        queryKey: goalsKey(runtime.epochId),
        queryFn: () => runtime.apiClient.read(goalsEndpoint),
        staleTime: 0,
      })
    } catch {
      setGoalsRefreshFailed(true)
    } finally {
      setRefreshingGoals(false)
    }
  }

  useEffect(() => {
    if (!mutation.unknownGate || unknownRefreshAttempted.current) return
    unknownRefreshAttempted.current = true
    void refreshGoals()
  })

  const loadCreatedDetail = async (goalId: number) => {
    if (detailFlight.current || didNavigate.current) return
    detailFlight.current = true
    navigationLock.current = true
    setDetailState('loading')
    try {
      await queryClient.fetchQuery({
        queryKey: goalDetailKey(runtime.epochId, goalId),
        queryFn: () => runtime.apiClient.read(createGoalDetailEndpoint(goalId)),
        staleTime: 0,
      })
      if (didNavigate.current) return
      didNavigate.current = true
      navigationUnlocked.current = true
      router.replace({ pathname: '/goals/[goalId]', params: { goalId: String(goalId) } })
    } catch {
      navigationLock.current = false
      setDetailState('unavailable')
    } finally {
      detailFlight.current = false
    }
  }

  const submit = async (payload: GoalCreateWrite) => {
    if (submissionGate.current || mutation.isPending || mutation.unknownGate) return
    submissionGate.current = true
    navigationLock.current = true
    setFailure(null)
    try {
      const created = await mutation.mutateAsync(payload)
      setConfirmedGoalId(created.goalId)
      await loadCreatedDetail(created.goalId)
    } catch (error) {
      navigationLock.current = false
      const kind = classifyGoalCreateFailure(error)
      setFailure(kind)
      if (kind !== 'unknown') submissionGate.current = false
      else await refreshGoals()
    }
  }

  const returnToGoals = () => {
    navigationUnlocked.current = true
    router.replace('/goals')
  }

  return <GoalCreateScreen
    pending={mutation.isPending || detailState === 'loading'}
    failure={failure}
    unknownPayload={mutation.unknownGate?.payload ?? null}
    refreshingGoals={refreshingGoals}
    goalsRefreshFailed={goalsRefreshFailed}
    confirmedGoalId={confirmedGoalId}
    detailState={detailState}
    onBack={returnToGoals}
    onSubmit={submit}
    onRefreshGoals={refreshGoals}
    onRetryDetails={async () => { if (confirmedGoalId !== null) await loadCreatedDetail(confirmedGoalId) }}
  />
}
