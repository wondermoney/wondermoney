import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'

import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import {
  isFirstBankConnection,
  resolveConnectionOutcomes,
  tallyConnections,
  type ConnectionTally,
} from './connection-outcome-policy'
import { ConnectionsScreen, type ConnectionDisconnectFailureState } from './connections-screen'
import { mapBankConnections } from './connection-status-view-model'
import { classifyBankConnectionDisconnectFailure, useBankConnectionDisconnectMutation } from './use-bank-connection-disconnect-mutation'
import { useBankConnections } from './use-bank-connections'

function resolveViewState(query: ReturnType<typeof useBankConnections>) {
  if (query.isAccessTransition) return { status: 'access-transition' as const }
  if (query.data) {
    return { status: 'loaded' as const, rows: mapBankConnections(query.data.connections) }
  }
  if (query.isInitialFailure) {
    const code = (query.error as { code?: string } | null)?.code
    if (code === 'invalid-response') return { status: 'invalid-response' as const }
    if (code === 'http' && (query.error as { status?: number } | null)?.status === 404) {
      return { status: 'invalid-id' as const }
    }
    return { status: 'error' as const }
  }
  if (query.isNotFound) return { status: 'invalid-id' as const }
  return { status: 'loading' as const }
}

export function ConnectionsRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{ justStarted?: string }>()
  const query = useBankConnections()
  const state = resolveViewState(query)
  const disconnectMutation = useBankConnectionDisconnectMutation()
  const [disconnectFailure, setDisconnectFailure] = useState<ConnectionDisconnectFailureState | null>(null)

  // RAD-518 — this screen's polling is the app's only view of a consent flow
  // settling, so the terminal funnel steps are captured from the transition
  // between two of its own observations. See connection-outcome-policy.ts.
  const observedTally = useRef<ConnectionTally | null>(null)
  const rows = state.status === 'loaded' ? state.rows : null
  useEffect(() => {
    if (rows === null) return
    const next = tallyConnections(rows)
    const previous = observedTally.current
    observedTally.current = next
    if (isFirstBankConnection(previous, next)) {
      captureAnalyticsEvent('first_account_created', { method: 'bank_connection' })
    }
    for (const outcome of resolveConnectionOutcomes(previous, next)) {
      if (outcome === 'completed') captureAnalyticsEvent('bank_connection_completed')
      else captureAnalyticsEvent('bank_connection_failed')
    }
  }, [rows])

  return (
    <ConnectionsScreen
      state={state}
      justStarted={params.justStarted === '1'}
      refreshing={Boolean(query.isRefreshing)}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/more' as Href)
      }}
      onRetry={() => {
        void query.refetch()
      }}
      onRefresh={() => {
        void query.refetch()
      }}
      onConnectBank={() => router.push('/more/banking/connect' as Href)}
      onImportStatement={() => router.push('/more/banking/import' as Href)}
      onDisconnect={async (connectionId) => {
        setDisconnectFailure(null)
        try {
          await disconnectMutation.mutateAsync(connectionId)
        } catch (error) {
          setDisconnectFailure({ connectionId, failure: classifyBankConnectionDisconnectFailure(error) })
        }
      }}
      disconnectingConnectionId={disconnectMutation.isPending ? (disconnectMutation.variables ?? null) : null}
      disconnectFailure={disconnectFailure}
    />
  )
}
