import { useLocalSearchParams, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useAccounts } from '@/features/accounts/use-accounts'
import { ApiError } from '@/lib/api/errors'

import { GoalDetailScreen, type GoalDetailViewState } from './goal-detail-screen'
import { mapGoalActivities, mapGoalDetail } from './goal-detail-view-model'
import { parseGoalId } from './goals-contract'
import { useGoalDetail } from './use-goal-detail'
import { useGoalMutations } from './use-goal-mutations'

export function GoalDetailRoute() {
  const params = useLocalSearchParams<{ goalId?: string | string[] }>()
  const goalId = parseGoalId(params.goalId)
  const query = useGoalDetail(goalId)
  const accounts = useAccounts()
  const mutation = useGoalMutations()
  const router = useRouter()
  const { signOut } = useProductRuntime()
  let state: GoalDetailViewState

  if (query.isInvalidId) state = { status: 'invalid-id' }
  else if (query.isAccessTransition || accounts.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.isInvalidResponse) state = { status: 'invalid-response' }
  else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.data) {
    const goal = mapGoalDetail(query.data.detail)
    const loaded = {
      data: {
        goal,
        activities: mapGoalActivities(query.data.activities, goal.currencyCode),
        totalActivities: query.data.totalActivities,
      },
      activityStatus: query.isActivityLoading ? 'loading' as const : query.isActivityError ? 'error' as const : 'loaded' as const,
      hasMore: Boolean(query.hasMore),
      loadingMore: query.isLoadingMore,
      loadMoreError: query.isLoadMoreError,
      refreshing: query.isRefreshing,
    }
    state = query.isRefreshFailure ? { status: 'refresh-error', ...loaded } : { status: 'loaded', ...loaded }
  } else state = { status: 'error' }

  const accountContext = accounts.data ? {
    status: 'loaded' as const,
    accounts: accounts.data.accounts
      .filter((account) => Number.isSafeInteger(account.accountKey) && account.accountKey > 0)
      .map((account) => ({ accountId: account.accountKey, name: account.accountName })),
  } : accounts.isLoading ? {
    status: 'loading' as const,
    accounts: [],
  } : {
    status: accounts.error instanceof ApiError && accounts.error.code === 'invalid-response' ? 'invalid-response' as const : 'error' as const,
    accounts: [],
  }
  const goalWritePending = goalId !== null && mutation.isGoalPending(goalId)
  const goalWriteUnknown = goalId !== null && mutation.isGoalUnknown(goalId)
  const refresh = async () => {
    const successful = await query.refresh()
    if (successful && goalId !== null) mutation.clearGoalUnknown(goalId)
  }

  return (
    <GoalDetailScreen
      state={state}
      onBack={() => router.replace('/goals')}
      onRefresh={refresh}
      onLoadMore={query.loadMore}
      onLogout={signOut}
      accountContext={accountContext}
      mutationPending={goalWritePending}
      goalWriteUnknown={goalWriteUnknown}
      isGoalWriteBlocked={() => goalId !== null && mutation.isGoalWriteBlocked(goalId)}
      onSaveMetadata={async (value) => { if (goalId !== null) await mutation.mutateAsync({ kind: 'metadata', goalId, value }) }}
      onLinkAccount={async (accountId) => { if (goalId !== null) await mutation.mutateAsync({ kind: 'link', goalId, accountId }) }}
      onUnlinkAccount={async (accountId) => { if (goalId !== null) await mutation.mutateAsync({ kind: 'unlink', goalId, accountId }) }}
      onAssign={async (amount) => { if (goalId !== null) await mutation.mutateAsync({ kind: 'assign', goalId, amount }) }}
      onMoveOut={async (amount) => { if (goalId !== null) await mutation.mutateAsync({ kind: 'move-out', goalId, amount }) }}
      onArchive={async () => {
        if (goalId === null) return
        await mutation.mutateAsync({ kind: 'archive', goalId })
        router.replace('/goals')
      }}
    />
  )
}
