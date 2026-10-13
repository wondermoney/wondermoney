import { type Href, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { mapNetWorthHistory } from './net-worth-history-view-model'
import { NetWorthHistoryScreen, type NetWorthHistoryViewState } from './net-worth-history-screen'
import { useNetWorthHistory } from './use-net-worth-history'

export function NetWorthHistoryRoute() {
  const query = useNetWorthHistory()
  const { signOut } = useProductRuntime()
  const router = useRouter()

  let state: NetWorthHistoryViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    state = {
      status: 'loaded',
      data: mapNetWorthHistory(query.data),
      refreshFailed: query.isRefreshFailure,
      refreshing: query.isRefreshing,
    }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/' as unknown as Href)
  }

  return (
    <NetWorthHistoryScreen
      state={state}
      onBack={goBack}
      onRetry={async () => { await query.refetch() }}
      onLogout={signOut}
    />
  )
}
