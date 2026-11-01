import { expoClient } from '@better-auth/expo/client'
import { createAuthClient } from 'better-auth/client'
import { twoFactorClient } from 'better-auth/client/plugins'
import * as SecureStore from 'expo-secure-store'

import { getBetterAuthCookiePrefix } from './cookie-prefix'
import { createBetterAuthExpoStorage, type BetterAuthExpoStorage } from './secure-session-storage'

export type ApiAuthClientConfig = Readonly<{
  /**
   * The WonderMoney API origin (e.g. `https://api.wonder.money`). better-auth
   * appends its default `/api/auth` base path, so the existing server surface is
   * reused unchanged; `/v1/*` calls reuse the opaque session token this client
   * holds (see `app-auth-adapter.ts`).
   */
  baseUrl: string
  /** The Expo URL scheme better-auth uses for OAuth/recovery deep links (`wondermoney`). */
  scheme: string
  /**
   * Override for tests. Production always uses the hardened SecureStore adapter
   * below — there is no plaintext fallback.
   */
  storage?: BetterAuthExpoStorage
}>

/**
 * Constructs the better-auth Expo client. This is side-effect free apart from
 * reading persisted cookies from SecureStore, and issues no network request.
 *
 * `expoClient` persists the session cookie (and its cached session payload) in
 * the platform keychain through the hardened secure-session-storage adapter;
 * `twoFactorClient` adds the `twoFactor.enable/disable/verifyTotp/verifyBackupCode`
 * surface.
 */
export function createExpoAuthPlugin({ baseUrl, scheme, storage }: ApiAuthClientConfig) {
  const prefix = getBetterAuthCookiePrefix(baseUrl)

  return expoClient({
    scheme,
    cookiePrefix: prefix,
    storagePrefix: prefix,
    storage: storage ?? createBetterAuthExpoStorage(SecureStore),
  })
}

export function createApiAuthClient({ baseUrl, scheme, storage }: ApiAuthClientConfig) {
  return createAuthClient({
    baseURL: baseUrl,
    plugins: [
      createExpoAuthPlugin({ baseUrl, scheme, storage }),
      twoFactorClient(),
    ],
    // The session lifecycle owns foreground/background refresh explicitly (see
    // session-lifecycle.ts), so the client itself does not poll or refetch on
    // focus — that would race the operation-scope/epoch machinery.
    sessionOptions: { refetchInterval: 0, refetchOnWindowFocus: false },
  })
}
