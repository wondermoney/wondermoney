import PostHog from 'posthog-react-native'

import { POSTHOG_HOST, type AnalyticsClientPort } from './analytics'

/**
 * RAD-518 — the only module in the app that touches the PostHog SDK.
 *
 * Every SDK feature that can emit an event this app has not enumerated in
 * `docs/telemetry-adr.md` is switched off here, because the ADR allowlists nine
 * events and the SDK's defaults would add more on its own:
 *
 * - `captureAppLifecycleEvents` defaults to true and would send
 *   `Application Installed/Updated/Opened/Became Active/Backgrounded`.
 * - session replay and surveys would record screen content and user-authored
 *   answers, neither of which is approved.
 * - feature flags would add `$feature_flag_called` events and per-launch
 *   requests for a capability this app does not use.
 * - `personProfiles: 'never'` makes user-level identification structurally
 *   impossible, matching the ADR's "no `identify()` carrying PII" decision.
 *
 * Autocapture (touches and screen views) is only wired up by `PostHogProvider`,
 * which this app deliberately does not mount — screen views come from the closed
 * `feature_screen_viewed` enum instead of raw route paths.
 *
 * The host is a constant, not configuration: there is one approved ingest
 * endpoint and no reason for a build to point somewhere else.
 */
export function createPostHogAnalyticsClient(
  input: Readonly<{ apiKey: string }>,
): AnalyticsClientPort {
  const posthog = new PostHog(input.apiKey, {
    host: POSTHOG_HOST,
    captureAppLifecycleEvents: false,
    enableSessionReplay: false,
    disableSurveys: true,
    disableRemoteConfig: true,
    disableRemoteFeatureFlags: true,
    preloadFeatureFlags: false,
    sendFeatureFlagEvent: false,
    personProfiles: 'never',
  })

  return Object.freeze({
    capture: (event, properties) => {
      posthog.capture(event, properties)
    },
  })
}
