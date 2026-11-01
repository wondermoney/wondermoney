import { z } from 'zod'

/**
 * PostHog project API keys are write-only client credentials and are
 * prefixed `phc_`. Anything else in this slot (a personal API key `phx_`, a
 * feature-flag secret, an empty string from an unset shell variable) is refused
 * rather than shipped in the bundle. The ingest host is not configurable — see
 * analytics.ts.
 */
const posthogProjectKey = z
  .string()
  .min(1)
  .refine((key) => key.startsWith('phc_'), 'A public PostHog project key (phc_…) is required.')
  .brand<'PostHogProjectKey'>()

/**
 * Expo inlines only `EXPO_PUBLIC_*` variables into the bundle, so the
 * `NEXT_PUBLIC_API_URL`/`BETTER_AUTH_URL` pair from the web app collapses to a
 * single `EXPO_PUBLIC_API_BASE_URL` here. It is both the `/v1/*` API origin and
 * the base better-auth is mounted under (`<apiBaseUrl>/api/auth`); there is no
 * separate auth origin, so there are no secrets to misconfigure.
 */
const envSchema = z.discriminatedUnion('EXPO_PUBLIC_APP_ENV', [
  z.object({
    EXPO_PUBLIC_APP_ENV: z.literal('local'),
    EXPO_PUBLIC_API_BASE_URL: z.union([
      z.literal('http://localhost:3001'),
      z.literal('http://127.0.0.1:3001'),
      z.literal('http://10.0.2.2:3001'),
    ]),
    EXPO_PUBLIC_POSTHOG_KEY: posthogProjectKey,
  }),
  z.object({
    EXPO_PUBLIC_APP_ENV: z.literal('staging'),
    EXPO_PUBLIC_API_BASE_URL: z.literal('https://staging.api.wonder.money'),
    EXPO_PUBLIC_POSTHOG_KEY: posthogProjectKey,
  }),
  z.object({
    EXPO_PUBLIC_APP_ENV: z.literal('production'),
    EXPO_PUBLIC_API_BASE_URL: z.literal('https://api.wonder.money'),
    EXPO_PUBLIC_POSTHOG_KEY: posthogProjectKey,
  }),
])

export function parseEnv(input: Record<string, unknown>) {
  const env = envSchema.parse(input)

  return {
    appEnv: env.EXPO_PUBLIC_APP_ENV,
    apiBaseUrl: env.EXPO_PUBLIC_API_BASE_URL,
    posthogKey: env.EXPO_PUBLIC_POSTHOG_KEY,
  }
}
