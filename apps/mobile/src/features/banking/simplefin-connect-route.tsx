import * as Linking from 'expo-linking'
import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import { externalDestinations, isApprovedExternalDestination } from '@/features/more/link-policy'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { bankConnectionsHref } from './bank-connection-return'
import { SimplefinConnectScreen } from './simplefin-connect-screen'
import { classifySimplefinConnectFailure, type SimplefinConnectFailure, useConnectSimplefin } from './use-connect-simplefin'

/**
 * Connect with SimpleFIN → `POST /v1/banking/simplefin/connections` → back to the connections
 * list with the success notice, where the new connection shows `processing` and the list polls
 * it until its first sync settles. A failure stays on this screen.
 *
 * The mutation is reset as soon as it settles, so the token does not stay in its `variables`.
 * Analytics carry no token, no error text and no institution, the same as the Enable Banking flow.
 */
export function SimplefinConnectRoute() {
  const router = useRouter()
  const connect = useConnectSimplefin()
  const [failure, setFailure] = useState<SimplefinConnectFailure | null>(null)

  return (
    <SimplefinConnectScreen
      submitting={connect.isPending}
      failure={failure}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/more/banking' as Href)
      }}
      onOpenBridge={() => {
        const destination = externalDestinations.simplefinBridge
        if (isApprovedExternalDestination(destination)) void Linking.openURL(destination).catch(() => undefined)
      }}
      onSubmit={(setupToken) => {
        setFailure(null)
        connect.mutate(setupToken, {
          onSuccess: () => {
            captureAnalyticsEvent('bank_connection_started')
            router.replace(bankConnectionsHref('success') as Href)
          },
          onError: (error) => {
            captureAnalyticsEvent('bank_connection_failed')
            setFailure(classifySimplefinConnectFailure(error))
          },
          onSettled: () => {
            connect.reset()
          },
        })
      }}
    />
  )
}
