/**
 * Crash/error reporting boundary, bound by `docs/telemetry-adr-sentry.md`.
 *
 * The ADR is the spec, not a guideline. Its central rule is that a call site has
 * nowhere to put anything: `captureError` takes one argument and it is the error
 * itself. There is no second parameter, so `captureError(error, { extra: {
 * accountId } })` — the exact leak the ADR names — does not compile. That is the
 * same technique `analytics.ts` uses for PostHog (an event allowlist as a type rather
 * than a convention), applied to the one shape Sentry's own API leaves open.
 *
 * Deliberately absent: `setUser`, `setTag`, `setContext`, `setExtra`,
 * `addBreadcrumb`, and any way to reach the Sentry scope. The ADR leaves user
 * identification unapproved and custom context unapproved, so this boundary
 * exposes no surface that could carry an email, a user ID, a device
 * identifier, an account/portfolio ID, an amount, or user-authored text.
 *
 * This module never imports the Sentry SDK; the vendor client is injected as an
 * `ErrorReporterPort` (see `sentry-error-client.ts`), the same
 * dependency-injected shape as `analytics.ts` and the auth adapters.
 */

import { isAnalyticsCaptureApproved } from './analytics'

/**
 * Fixed by decision, not configuration: mobile's own Sentry project
 * (`wonder-money/mobile`). A DSN is a write-only ingest identifier rather than a
 * secret, so — like `POSTHOG_HOST` — there is no environment variable for it and
 * no reason for a build to point somewhere else.
 *
 * This supersedes the ADR's original approval line, which reused web's DSN. That
 * reuse did exactly what the ADR predicted it might: mobile errors landed in
 * web's project and diluted its dashboards (two mobile issues were sitting in
 * web's issue list on 2026-08-20, attributed to web). The ADR named a separate
 * project as the remedy for precisely that; this is that remedy.
 *
 * Still US-hosted, and deliberately so: a Sentry data region is fixed per *org*,
 * and `wonder-money` is US. Splitting the project does not move the data, so the
 * ADR's open question — crash data in the US while PostHog analytics is EU —
 * remains accepted, not resolved. Resolving it would mean a separate EU org.
 */
export const SENTRY_DSN = 'https://397525327286be42f3f2f5d7cc89ac28@o438497.ingest.us.sentry.io/4511944590622720'

/**
 * The vendor seam. One method, one parameter — an adapter cannot widen it to
 * pass context through even if a future Sentry API invites one.
 */
export type ErrorReporterPort = Readonly<{
  captureException: (error: unknown) => void
}>

export type ErrorReporting = Readonly<{
  captureError: (error: unknown) => void
}>

export const disabledErrorReporting: ErrorReporting = Object.freeze({
  captureError: (_error: unknown): void => undefined,
})

export type ErrorReportingConfig = Readonly<{ environment: string }>

/**
 * Builds the capture boundary for an environment. Anything other than an
 * approved environment paired with a real client yields the disabled reporter,
 * which is inert: no queue, no offline cache, no network, no global handlers.
 *
 * The gate is the analytics one, imported rather than re-implemented, so there
 * are never two allowlists to keep in step: when the approved-environment set
 * changes it changes for both vendors at once.
 */
export function createErrorReporting(
  input: Readonly<{ environment: string; client: ErrorReporterPort | null }>,
): ErrorReporting {
  const { client } = input
  if (!isAnalyticsCaptureApproved(input.environment) || !client) return disabledErrorReporting

  return Object.freeze({
    captureError: (error: unknown): void => {
      client.captureException(error)
    },
  })
}

let active: ErrorReporting = disabledErrorReporting

/**
 * Installs the process-wide crash/error boundary. Called once, from the root
 * layout, with the validated public environment. `createClient` is invoked only
 * for an approved environment, so an unapproved build never calls `Sentry.init`
 * at all — no native SDK start, no global error handlers, no offline envelope
 * cache on disk. The gate is not "initialize it and hope nothing captures".
 */
export function initErrorReporting(
  input: Readonly<{
    config: ErrorReportingConfig | undefined
    createClient: (input: Readonly<{ environment: string }>) => ErrorReporterPort
  }>,
): ErrorReporting {
  const { config } = input
  if (!config || !isAnalyticsCaptureApproved(config.environment)) {
    active = disabledErrorReporting
    return active
  }
  active = createErrorReporting({
    environment: config.environment,
    client: input.createClient({ environment: config.environment }),
  })
  return active
}

/** Test seam: restores the pre-init, inert boundary. */
export function resetErrorReporting(): void {
  active = disabledErrorReporting
}

/**
 * The one call every feature uses, and the whole public surface. A no-op until
 * `initErrorReporting` runs and until the environment is approved, so call sites
 * never branch on either.
 *
 * Callers own the PII-safety of what they pass. The ADR is explicit that
 * scrubbing cannot rescue an error whose own `.message` was built by
 * interpolating a value, so a call site must pass an error whose message is a
 * fixed string — `ApiError`, `SecureSessionStorageError`, and the auth adapter's
 * bare `{ status }` outcomes are the shapes this codebase already uses for that.
 * Never pass a provider/parser error through unchanged.
 */
export function captureError(error: unknown): void {
  active.captureError(error)
}
