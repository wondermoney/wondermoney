import * as Sentry from '@sentry/react-native'
import type { Breadcrumb, Event } from '@sentry/react-native'

import { SENTRY_DSN, type ErrorReporterPort } from './error-reporting'

/**
 * RAD-517 — the only module in the app that touches the Sentry SDK.
 *
 * Every SDK feature that would send more than a stack trace is switched off
 * here, co-located with the client construction the same way
 * `posthog-analytics-client.ts` co-locates PostHog's feature-disabling options.
 * `docs/telemetry-adr-sentry.md` decides each of these; none is a preference:
 *
 * - **No Session Replay, at any rate.** `mobileReplayIntegration()` is added by
 *   the SDK's own defaults if — and only if — `replaysSessionSampleRate` or
 *   `replaysOnErrorSampleRate` is a number, so the enforcement is that neither
 *   option appears below. Web sets both; recording screen video of a financial
 *   app whose balances are drawn into Skia charts (not maskable "text") is the
 *   single biggest reason this ADR exists.
 * - **No screenshots or view hierarchy.** Both default to false; both are stated
 *   anyway, because both are one-line opt-ins to the same class of leak as
 *   replay and a future reader should see them refused rather than omitted.
 * - **No logs.** `enableLogs` is what pulls in `consoleLoggingIntegration`, i.e.
 *   the contents of every `console.*` call. The ADR drops console *breadcrumbs*
 *   in `beforeSend`; this closes the other door to the same data.
 * - **No PII from integrations.** `sendDefaultPii: false` is the SDK-wide switch
 *   that keeps the native layers from attaching the device name (frequently a
 *   person's real name) and the request IP.
 * - **No performance tracing.** `tracesSampleRate: 0` is the ADR's wording, but
 *   on its own it is not enough: the SDK's `getDefaultIntegrations` treats
 *   *any* numeric `tracesSampleRate` — including zero — as "tracing enabled" and
 *   installs app-start, native-frames, stall-tracking, user-interaction and
 *   auto-performance integrations. The four `enable*` flags below are what
 *   actually keep this ticket to crash/error reporting.
 * - **No `Sentry.setUser`, anywhere.** Not called here and unreachable through
 *   `ErrorReporterPort`; `beforeSend` deletes `event.user` as well, so an
 *   identity would have to survive three separate refusals to ship.
 *
 * `Sentry.wrap()` is deliberately not applied to the root component either: it
 * mounts `TouchEventBoundary`, which records a breadcrumb per touch containing
 * the touched element's accessibility label — in this app that is routinely a
 * formatted balance or an account name. Its other job is performance profiling,
 * which this ticket does not enable. Uncaught render errors do not need it: the
 * default `reactNativeErrorHandlersIntegration` hooks React Native's global
 * `ErrorUtils` handler and unhandled promise rejections, and native crashes are
 * captured by the native SDKs.
 */
export function createSentryErrorClient(
  input: Readonly<{ environment: string }>,
): ErrorReporterPort {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: input.environment,
    debug: false,
    beforeSend: scrubSentryEvent,
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,
    enableUserInteractionTracing: false,
    enableStallTracking: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
    sendDefaultPii: false,
    enableLogs: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
  })

  return Object.freeze({
    captureException: (error: unknown): void => {
      // No second argument, ever — see the ADR's rule 4 and `error-reporting.ts`.
      Sentry.captureException(error)
    },
  })
}

/**
 * Breadcrumb categories the SDK creates for network activity. `xhr` and `fetch`
 * come from the browser breadcrumbs integration (React Native's networking is
 * XHR under the hood); `http` is what the native layers emit.
 */
const httpBreadcrumbCategories: ReadonlySet<string> = new Set(['xhr', 'fetch', 'http'])

/**
 * Drops the query string and fragment from a URL. Not required by the ADR's
 * minimum, but the ADR's rule is that safety comes from construction: this app's
 * OAuth/recovery deep links carry tokens in exactly those two positions, and a
 * path alone is all a stack trace needs to be readable.
 */
function urlPathOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.split('#')[0]?.split('?')[0]
}

/**
 * Rebuilds a breadcrumb from an allowlist rather than deleting known-bad keys —
 * a denylist would silently pass whatever key a future SDK version adds.
 * Returns `null` for breadcrumbs that must not be sent at all.
 */
function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Log statements can contain anything. This app's source has no console.* calls
  // (confirmed during RAD-193's audit), so this is defense in depth against a
  // future one, plus the SDK's own internal logging.
  if (breadcrumb.category === 'console') return null
  if (!httpBreadcrumbCategories.has(breadcrumb.category ?? '')) return breadcrumb

  const data = breadcrumb.data ?? {}
  const url = urlPathOnly(data.url)
  const scrubbed: Breadcrumb = {
    ...(breadcrumb.type === undefined ? {} : { type: breadcrumb.type }),
    ...(breadcrumb.category === undefined ? {} : { category: breadcrumb.category }),
    ...(breadcrumb.level === undefined ? {} : { level: breadcrumb.level }),
    ...(breadcrumb.timestamp === undefined ? {} : { timestamp: breadcrumb.timestamp }),
    data: {
      ...(url === undefined ? {} : { url }),
      ...(typeof data.method === 'string' ? { method: data.method } : {}),
      ...(typeof data.status_code === 'number' ? { status_code: data.status_code } : {}),
    },
  }
  return scrubbed
}

/**
 * The ADR's mandatory scrub, applied to every event before it leaves the device.
 * Exported so it can be tested directly against synthetic events — a scrubbing
 * regression is invisible in manual testing, which is precisely why it gets a
 * real test rather than a code review.
 *
 * What it removes and why:
 *
 * - `user` — rule 3. Nothing sets it, and nothing may.
 * - `extra` — rule 4, and the `extra` React error boundaries attach by default.
 *   No approved call site produces one, so removing all of it costs nothing.
 * - `contexts.react` — where `@sentry/react`'s error boundary puts the component
 *   stack, which can carry prop values. The remaining contexts (`device`, `os`,
 *   `app`) are the SDK's own build/runtime metadata and are kept: with
 *   `sendDefaultPii: false` they hold no identifiers, and without them a crash
 *   report cannot be tied to an OS version.
 * - `request` — reduced to method and a query-less URL, which drops the body
 *   (`request.data`), `cookies`, and every header including `Authorization`.
 *   Rebuilt from an allowlist for the same reason breadcrumbs are.
 * - console breadcrumbs, and the body/headers of HTTP breadcrumbs.
 */
export function scrubSentryEvent<E extends Event>(event: E): E {
  const scrubbed: E = { ...event }

  delete scrubbed.user
  delete scrubbed.extra

  if (scrubbed.contexts) {
    const { react: _componentStack, ...rest } = scrubbed.contexts
    scrubbed.contexts = rest
  }

  if (scrubbed.request) {
    const url = urlPathOnly(scrubbed.request.url)
    scrubbed.request = {
      ...(url === undefined ? {} : { url }),
      ...(scrubbed.request.method === undefined ? {} : { method: scrubbed.request.method }),
    }
  }

  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null)
  }

  return scrubbed
}
