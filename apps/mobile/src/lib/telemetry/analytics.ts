/**
 * Product analytics boundary, bound by `docs/telemetry-adr.md`.
 *
 * Event names and their properties come from the event catalogue in
 * `@wondermoney/shared/analytics` (`packages/shared/lib/analytics/catalogue.ts`):
 * `AnalyticsCaptureArgs` is a discriminated union over exactly the catalogue's
 * mobile events, so an event name or a property shape that is not catalogued is
 * a compile error at the call site rather than a code-review question.
 *
 * Deliberately absent: `identify`, `alias`, `group`, `register`, and any
 * free-form `properties` escape hatch. The ADR leaves user-level identification
 * unapproved, so there is no surface here that could carry an email, a name, a
 * user ID, a resource ID, an amount, or user-authored text.
 *
 * This module never imports the PostHog SDK; the vendor client is injected as an
 * `AnalyticsClientPort` (see `posthog-analytics-client.ts`), the same
 * dependency-injected shape as the auth and security adapters.
 */

import {
  type AnalyticsCaptureArgs as CatalogueCaptureArgs,
  type AnalyticsEventNameFor,
  type AnalyticsEventProperties,
  type AnalyticsPropertyValue,
  type MobileFeatureScreen as FeatureScreen,
  mobileFeatureScreens as featureScreens,
} from '@wondermoney/shared/analytics'

/** Fixed by decision, not configuration: this app's only approved ingest host. */
export const POSTHOG_HOST = 'https://eu.posthog.com'

/**
 * The closed list of route identifiers for `feature_screen_viewed`, kept in the event catalogue
 * with the event it belongs to. Routes that resolve to no identifier are simply not captured — see
 * `resolveFeatureScreen`.
 */
export { featureScreens, type FeatureScreen }

export type AnalyticsAuthProvider = AnalyticsEventProperties<'sign_in_completed'>['provider']
export type AnalyticsFeedbackCategory = AnalyticsEventProperties<'feedback_submitted'>['category']

export type AnalyticsEvent = AnalyticsEventNameFor<'mobile'>

/**
 * Argument tuples for `capture`, one per catalogue event with `mobile` among its surfaces
 * (`@wondermoney/shared/analytics`). Because the property type is the exact object type for that
 * event, TypeScript's excess-property check rejects an extra key on an object literal — that is
 * what keeps a well-meaning `{ provider: 'email', userId }` from ever compiling.
 */
export type AnalyticsCaptureArgs = CatalogueCaptureArgs<'mobile'>

/**
 * The vendor seam. Property values are the catalogue's kinds (a value from a
 * fixed list, a boolean or a count); an object cannot be passed through this
 * port even by an adapter.
 */
export type AnalyticsClientPort = Readonly<{
  capture: (
    event: AnalyticsEvent,
    properties?: Readonly<Record<string, AnalyticsPropertyValue>>,
  ) => void
}>

export type Analytics = Readonly<{
  capture: (...args: AnalyticsCaptureArgs) => void
}>

/**
 * The approved capture environments (`local`, `staging`, `production`) — see
 * `docs/telemetry-adr.md` and `docs/telemetry-adr-sentry.md`. The
 * event/property allowlist this gate protects forbids free-form properties,
 * `identify()` and PII. The parameter is a plain `string`, not
 * `MobileEnvironment['appEnv']`, so this stays an explicit allowlist rather
 * than a denylist.
 */
export function isAnalyticsCaptureApproved(environment: string): boolean {
  if (environment !== 'local' && environment !== 'staging' && environment !== 'production') return false
  return true
}

export const disabledAnalytics: Analytics = Object.freeze({
  capture: (..._args: AnalyticsCaptureArgs): void => undefined,
})

export type AnalyticsConfig = Readonly<{
  environment: string
  apiKey: string
}>

/**
 * Builds the capture boundary for an environment. Anything other than an
 * approved environment paired with a real client yields the disabled analytics,
 * which is inert: no queue, no storage, no network.
 */
export function createAnalytics(
  input: Readonly<{ environment: string; client: AnalyticsClientPort | null }>,
): Analytics {
  const { client } = input
  if (!isAnalyticsCaptureApproved(input.environment) || !client) return disabledAnalytics

  return Object.freeze({
    capture: (...args: AnalyticsCaptureArgs): void => {
      const [event, properties] = args
      client.capture(event, properties)
    },
  })
}

let active: Analytics = disabledAnalytics

/**
 * Installs the process-wide analytics boundary. Called once, from the root
 * layout, with the validated public environment. `createClient` is invoked only
 * for an approved environment, so an unapproved build never constructs a PostHog
 * instance at all — the gate is not "construct it and hope nothing captures".
 */
export function initAnalytics(
  input: Readonly<{
    config: AnalyticsConfig | undefined
    createClient: (input: Readonly<{ apiKey: string }>) => AnalyticsClientPort
  }>,
): Analytics {
  const { config } = input
  if (!config || !isAnalyticsCaptureApproved(config.environment)) {
    active = disabledAnalytics
    return active
  }
  active = createAnalytics({
    environment: config.environment,
    client: input.createClient({ apiKey: config.apiKey }),
  })
  return active
}

/** Test seam: restores the pre-init, inert boundary. */
export function resetAnalytics(): void {
  active = disabledAnalytics
}

/**
 * The one call every feature uses. A no-op until `initAnalytics` runs and until
 * the environment is approved, so call sites never branch on either.
 */
export function captureAnalyticsEvent(...args: AnalyticsCaptureArgs): void {
  active.capture(...args)
}
