import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'

import { GoalsScreen, type GoalsViewState } from './goals-screen'
import { mapGoals } from './goals-view-model'
import { useGoalMutations } from './use-goal-mutations'
import { useGoals } from './use-goals'
import { useGoalCreateUnknownGate } from './use-create-goal'

export function GoalsRoute() {
  const [view, setView] = useState<'active' | 'archived'>('active')
  const query = useGoals(view === 'archived')
  const restoreMutation = useGoalMutations()
  const unknownGate = useGoalCreateUnknownGate()
  const router = useRouter()
  const { signOut } = useProductRuntime()
  const reviewedUnknown = useRef(false)
  useEffect(() => {
    if (!unknownGate || reviewedUnknown.current) return
    reviewedUnknown.current = true
    void query.refetch()
  }, [query, unknownGate])
  let state: GoalsViewState

  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const mapped = mapGoals(query.data)
    const data = { goals: view === 'archived' ? mapped.filter((goal) => goal.effectiveStatus === 'archived') : mapped }
    state = query.isRefreshFailure
      ? { status: 'refresh-error', data, refreshing: query.isRefreshing }
      : { status: 'loaded', data, refreshing: query.isRefreshing }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  return (
    <GoalsScreen
      state={state}
      view={view}
      onSelectView={setView}
      onRefresh={async () => { await query.refetch() }}
      onLogout={signOut}
      onViewGoal={(goalId) => router.push({ pathname: '/goals/[goalId]', params: { goalId: String(goalId) } })}
      onCreateGoal={() => { if (!unknownGate) router.push('/goals/create') }}
      onViewDebtStrategy={() => router.push('/goals/debt-strategy')}
      createBlocked={unknownGate !== null}
      onRestoreGoal={(goalId) => { void restoreMutation.mutateAsync({ kind: 'restore', goalId }) }}
      restorePending={restoreMutation.isGoalPending}
    />
  )
}
