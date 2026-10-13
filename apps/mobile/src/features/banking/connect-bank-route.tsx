import { type Href, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'

import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import type { ConnectBankScreenState } from './connect-bank-screen'
import { ConnectBankScreen } from './connect-bank-screen'
import { mapBankInstitutions } from './institutions-view-model'
import { useBankInstitutions } from './use-bank-institutions'
import { classifyStartBankConnectionFailure, type StartBankConnectionFailure, useStartBankConnection } from './use-start-bank-connection'
import { useReturnFromBrowser } from './use-return-from-browser'

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
 * RAD-240 — institution picker → start requisition → in-app browser consent.
 * There is no native-app callback (see start-connection-contract.ts), so once
 * the browser opens this route arms useReturnFromBrowser and, on return,
 * hands off to the connections list with a `justStarted` marker rather than
 * claiming to know the connection succeeded.
 */
export function ConnectBankRoute() {
  const router = useRouter()
  const institutions = useBankInstitutions()
  const start = useStartBankConnection()
  const [browserArmed, setBrowserArmed] = useState(false)
  const [startFailure, setStartFailure] = useState<StartBankConnectionFailure | null>(null)

  useReturnFromBrowser(browserArmed, () => {
    setBrowserArmed(false)
    router.replace({ pathname: '/more/banking', params: { justStarted: '1' } } as Href)
  })

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
            // RAD-518 — an authorization exists and consent is about to open.
            // No institution name and no redirect URL: the ADR approves no
            // properties here, and the redirect URL is a credential-bearing URL.
            captureAnalyticsEvent('bank_connection_started')
            setBrowserArmed(true)
            WebBrowser.openBrowserAsync(redirectUrl, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC }).catch(() => {
              // Best-effort: if the browser itself never opened, return-detection
              // has nothing to key off. Fall back to the connections screen's
              // manual refresh rather than leaving the user stuck on the picker.
              setBrowserArmed(false)
              router.replace('/more/banking' as Href)
            })
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
