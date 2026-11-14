import * as SecureStore from 'expo-secure-store'

import type { ServerSwitch } from '@/components/providers/server-switch-provider'
import { type PairingSession, type PairingStorage, storePairedSession } from '@/lib/auth/pairing'

/** The hardened SecureStore write the session cookie goes through outside tests. */
export const secureSessionWriter: PairingStorage = {
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    }),
}

/**
 * Signs the app in with a session the API handed over (QR pairing, the demo sign-in).
 *
 * Order matters: the session cookie is written to the Expo client's storage *before* the
 * server switch rebuilds the auth client, because the client reads persisted cookies when it
 * is constructed. After the switch the normal session bootstrap finds the session and the app
 * opens signed in, through the same activation a password sign-in ends in.
 *
 * Adopting a session on the build's default server leaves the server choice unsaved, so a
 * later build that changes the default still moves the app with it.
 */
export async function adoptSession(
  serverSwitch: ServerSwitch,
  server: string,
  session: PairingSession,
  storage: PairingStorage = secureSessionWriter,
): Promise<void> {
  await storePairedSession(server, session, storage)
  const staysOnDefault = serverSwitch.usesDefaultServer && server === serverSwitch.apiBaseUrl
  await serverSwitch.switchServer(staysOnDefault ? null : server)
}
