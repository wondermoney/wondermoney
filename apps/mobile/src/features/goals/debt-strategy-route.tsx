import { useRouter } from 'expo-router'

import { useAccounts } from '@/features/accounts/use-accounts'

import { DebtStrategyScreen, type DebtStrategyViewState } from './debt-strategy-screen'
import { mapDebtStrategy } from './debt-strategy-view-model'
import { useDebtStrategy } from './use-debt-strategy'

export function DebtStrategyRoute() {
  const query = useDebtStrategy()
  const accounts = useAccounts()
  const router = useRouter()
  let state: DebtStrategyViewState

  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.isInvalidResponse) state = { status: 'invalid-response' }
  else if (query.data) {
    state = query.isRefreshFailure
      ? { status: 'refresh-error', data: mapDebtStrategy(query.data), refreshing: query.isRefreshing }
      : { status: 'loaded', data: mapDebtStrategy(query.data), refreshing: query.isRefreshing }
  } else state = { status: 'error' }

  // Best-effort only: currency is decorative context for formatting amounts, matching web's own
  // choice of the tenant's first account currency. An accounts failure should not block this
  // read-only strategy comparison from rendering.
  const currencyCode = accounts.data?.accounts[0]?.accountOwnerAppuserKey.currencyKey.code ?? null

  return <DebtStrategyScreen
    state={state}
    currencyCode={currencyCode}
    onBack={() => router.replace('/goals')}
    onRefresh={async () => { await Promise.all([query.refetch(), accounts.refetch()]) }}
  />
}
