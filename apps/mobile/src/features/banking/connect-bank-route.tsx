import { type Href, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'

import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { BANK_CONNECTION_RETURN_URL, bankConnectionsHref, readBankConnectionResult } from './bank-connection-return'
import type { ConnectBankScreenState } from './connect-bank-screen'
import { ConnectBankScreen } from './connect-bank-screen'
import { mapBankInstitutions } from './institutions-view-model'
import { useBankInstitutions } from './use-bank-institutions'
import { classifyStartBankConnectionFailure, type StartBankConnectionFailure, useStartBankConnection } from './use-start-bank-connection'

function resolveViewState(query: ReturnType<typeof useBankInstitutions>): ConnectBankScreenState {
  if (query.isAccessTransition) return { status: 'access-transition' }
  if (query.data) return { status: 'loaded', rows: mapBankInstitutions(query.data) }
  if (query.isInitialFailure) {
    const code = (query.error as { code?: string } | null)?.code
    return code === 'invalid-response' ? { status: 'invalid-response' } : { status: 'error' }
  }
  return { status: 'loading' }
}

/**
 * Institution picker → start authorization → consent in an auth session.
 * The connection is started with `returnTo=mobile`, so the API's callback
 * redirects to the app's own return link and the session closes itself.
 * However the session ends (it saw the return link, or the user closed it),
 * this route hands off to the connections list with a `justStarted` marker,
 * plus the callback's outcome when the session saw it. Otherwise the list polls.
 */
export function ConnectBankRoute() {
  const router = useRouter()
  const institutions = useBankInstitutions()
  const start = useStartBankConnection()
  const [startFailure, setStartFailure] = useState<StartBankConnectionFailure | null>(null)

  return (
    <ConnectBankScreen
      state={resolveViewState(institutions)}
      pendingBankId={start.isPending ? (start.variables ?? null) : null}
      startFailure={startFailure}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/more/banking' as Href)
      }}
      onRetry={() => { void institutions.refetch() }}
      onSelectBank={(row) => {
        setStartFailure(null)
        start.mutate(row.id, {
          onSuccess: ({ redirectUrl }) => {
            // An authorization exists and consent is about to open.
            // No institution name and no redirect URL: the ADR approves no
            // properties here, and the redirect URL is a credential-bearing URL.
            captureAnalyticsEvent('bank_connection_started')
            WebBrowser.openAuthSessionAsync(redirectUrl, BANK_CONNECTION_RETURN_URL).then(
              (result) => {
                router.replace(bankConnectionsHref(readBankConnectionResult(result)) as Href)
              },
              () => {
                // The session never opened. Fall back to the connections
                // screen's manual refresh rather than leaving the user stuck
                // on the picker.
                router.replace('/more/banking' as Href)
              },
            )
          },
          onError: (error) => {
            // The connection never got off the ground. The classified reason
            // stays on screen; no error text or code reaches analytics.
            captureAnalyticsEvent('bank_connection_failed')
            setStartFailure(classifyStartBankConnectionFailure(error))
          },
        })
      }}
    />
  )
}
