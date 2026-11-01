import { createDefaultProductRuntime } from '@/components/providers/product-runtime-provider'
import { createFetchTransport } from '@/lib/api/fetch-transport'
import type { AppAuthAdapter, AuthSession } from '@/lib/auth/app-auth'
import { createAppAuthAdapter, type BetterAuthClientPort } from '@/lib/auth/app-auth-adapter'
import { createApiAuthClient } from '@/lib/auth/auth-client'
import {
  createPasswordRecoveryAdapter,
  type PasswordRecoveryAdapter,
  type PasswordRecoveryClientPort,
} from '@/lib/auth/password-recovery'
import { createSessionLifecycle } from '@/lib/auth/session-lifecycle'
import { parseEnv } from '@/lib/env/env'
import type { AnalyticsConfig } from '@/lib/telemetry/analytics'
import type { ErrorReportingConfig } from '@/lib/telemetry/error-reporting'

import type { AppStatePort } from '../auth/session-lifecycle'

/** The Expo URL scheme better-auth uses for OAuth/recovery deep links. */
const AUTH_SCHEME = 'wondermoney'

export type LiveAppDependencies = Readonly<{
  auth: AppAuthAdapter
  createSessionLifecycle: () => ReturnType<typeof createSessionLifecycle<AuthSession>>
  transport: ReturnType<typeof createFetchTransport>
  passwordRecovery: PasswordRecoveryAdapter
  runtimeFactory: typeof createDefaultProductRuntime
  /**
   * Validated inputs for the analytics boundary, not a constructed client:
   * building the PostHog instance here would put a vendor SDK — and its queue,
   * storage and timers — inside a function whose contract is "constructs local
   * clients only, issues no request". The root layout owns the construction.
   */
  analytics: AnalyticsConfig
  /**
   * Same reasoning as `analytics` above, and the reason this is a separate field
   * rather than a read of `analytics.environment`: the Sentry DSN is a constant
   * (see `error-reporting.ts`), so the only environment-dependent input crash
   * reporting has is the environment itself.
   */
  errorReporting: ErrorReportingConfig
  /** The API this runtime talks to: the build's default, or a server the user chose. */
  apiBaseUrl: string
  /**
   * False when the user pointed the app at another server. The build's analytics and crash
   * reporting belong to the default server's operator, so they stay off for anyone else's.
   */
  usesDefaultServer: boolean
}>

export type LiveAppDependenciesResult =
  | { status: 'available'; dependencies: LiveAppDependencies }
  | { status: 'unavailable' }

/**
 * Constructs local clients only. Neither the better-auth client nor the fetch
 * transport issues a request during construction: creating the client only reads
 * persisted cookies from SecureStore, and the transport is a bare function.
 */
export function createLiveAppDependencies(
  env: Record<string, unknown>,
  appState: AppStatePort,
  fetchImpl: typeof fetch = globalThis.fetch,
  serverUrl: string | null = null,
): LiveAppDependenciesResult {
  try {
    const parsed = parseEnv(env)
    const apiBaseUrl = serverUrl ?? parsed.apiBaseUrl
    const client = createApiAuthClient({ baseUrl: apiBaseUrl, scheme: AUTH_SCHEME })
    // The better-auth client exposes a superset of both ports; the casts only
    // narrow it to the members each consumer is allowed to touch.
    const auth = createAppAuthAdapter(client as unknown as BetterAuthClientPort)
    const passwordRecovery = createPasswordRecoveryAdapter(client as unknown as PasswordRecoveryClientPort)
    const transport = createFetchTransport({ baseUrl: apiBaseUrl, fetchImpl })
    return {
      status: 'available',
      dependencies: {
        auth,
        transport,
        passwordRecovery,
        runtimeFactory: createDefaultProductRuntime,
        analytics: { environment: parsed.appEnv, apiKey: parsed.posthogKey },
        errorReporting: { environment: parsed.appEnv },
        createSessionLifecycle: () => createSessionLifecycle({ auth, appState }),
        apiBaseUrl,
        usesDefaultServer: apiBaseUrl === parsed.apiBaseUrl,
      },
    }
  } catch {
    return { status: 'unavailable' }
  }
}
