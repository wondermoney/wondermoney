import { type Href, useLocalSearchParams, useRouter } from 'expo-router'

import type { BankConnectionProvider } from './connection-status-contract'
import { SyncHistoryScreen, type SyncHistoryScreenState } from './sync-history-screen'
import { mapBankSyncHistory } from './sync-history-view-model'
import { useBankSyncHistory } from './use-bank-sync-history'

function parseConnectionId(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/** Only SimpleFIN changes the route; anything else is the Enable Banking id space, as before. */
function parseProvider(value: string | undefined): BankConnectionProvider {
  return value === 'SimpleFIN' ? 'SimpleFIN' : 'EnableBanking'
}

export function SyncHistoryRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{ connectionId?: string; institutionName?: string; provider?: string }>()
  const connectionId = parseConnectionId(params.connectionId)
  const query = useBankSyncHistory(connectionId, parseProvider(params.provider))

  const state: SyncHistoryScreenState = connectionId === null
    ? { status: 'error' }
    : query.data
      ? { status: 'loaded', rows: mapBankSyncHistory(query.data.syncs) }
      : query.isNotFound
        ? { status: 'not-found' }
        : query.isError
          ? { status: 'error' }
          : { status: 'loading' }

  return (
    <SyncHistoryScreen
      state={state}
      institutionName={params.institutionName ?? null}
      refreshing={query.isFetching && query.data !== undefined}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/more/banking' as Href)
      }}
      onRetry={() => {
        void query.refetch()
      }}
      onRefresh={() => {
        void query.refetch()
      }}
    />
  )
}
