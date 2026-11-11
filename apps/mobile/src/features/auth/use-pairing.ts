import * as Application from 'expo-application'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useState } from 'react'

import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { exchangePairingCode, type PairingOutcome, type PairingPayload, storePairedSession } from '@/lib/auth/pairing'

export type PairingStatus = 'idle' | 'pairing' | 'paired' | Exclude<PairingOutcome['status'], 'paired'>

type PairingDeps = Readonly<{
  appVersion?: string
  fetchImpl?: typeof fetch
  platform?: string
  /** Injected in tests; defaults to the hardened SecureStore write. */
  storage?: { setItem: (key: string, value: string) => Promise<void> }
}>

const secureStoreWriter = {
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    }),
}

/**
 * Scans a pairing QR into a signed-in session.
 *
 * Order matters: the session cookie is written to the Expo client's storage *before* the
 * server switch rebuilds the auth client, because the client reads persisted cookies when it
 * is constructed. After the switch the normal session bootstrap finds the session and the app
 * opens signed in, with nothing typed.
 */
export function usePairing(deps: PairingDeps = {}) {
  const serverSwitch = useServerSwitch()
  const [status, setStatus] = useState<PairingStatus>('idle')
  const [minAppVersion, setMinAppVersion] = useState<string | null>(null)

  const pair = useCallback(
    async (payload: PairingPayload): Promise<PairingStatus> => {
      if (!serverSwitch) {
        setStatus('unavailable')
        return 'unavailable'
      }

      setStatus('pairing')
      setMinAppVersion(null)
      const outcome = await exchangePairingCode(payload, {
        appVersion: deps.appVersion ?? Application.nativeApplicationVersion ?? '0.0.0',
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.platform ? { platform: deps.platform } : {}),
      })

      if (outcome.status !== 'paired') {
        if (outcome.status === 'update-required') setMinAppVersion(outcome.minAppVersion)
        setStatus(outcome.status)
        return outcome.status
      }

      await storePairedSession(payload.server, outcome.session, deps.storage ?? secureStoreWriter)
      await serverSwitch.switchServer(payload.server)
      setStatus('paired')
      return 'paired'
    },
    [deps.appVersion, deps.fetchImpl, deps.platform, deps.storage, serverSwitch],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setMinAppVersion(null)
  }, [])

  return { minAppVersion, pair, reset, status }
}
