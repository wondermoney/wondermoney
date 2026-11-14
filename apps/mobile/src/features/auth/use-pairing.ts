import * as Application from 'expo-application'
import { useCallback, useState } from 'react'

import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { exchangePairingCode, type PairingOutcome, type PairingPayload, type PairingStorage } from '@/lib/auth/pairing'

import { adoptSession } from './adopt-session'

export type PairingStatus = 'idle' | 'pairing' | 'paired' | Exclude<PairingOutcome['status'], 'paired'>

type PairingDeps = Readonly<{
  appVersion?: string
  fetchImpl?: typeof fetch
  platform?: string
  /** Injected in tests; defaults to the hardened SecureStore write. */
  storage?: PairingStorage
}>

/**
 * Scans a pairing QR into a signed-in session: the code is exchanged for a session, which
 * `adoptSession` stores and opens the app with, with nothing typed.
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

      await adoptSession(serverSwitch, payload.server, outcome.session, deps.storage)
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
