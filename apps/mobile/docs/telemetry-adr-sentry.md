# Mobile telemetry ADR: Sentry crash/error reporting

**Status:** Approved (2026-08-12), as written. DSN decision resolved: reuse web's existing
US-hosted DSN, accepting the mismatch with PostHog's EU hosting as a known, deliberate trade-off
rather than an oversight. This unblocks the Sentry implementation against exactly the rules above.
*(DSN reuse superseded 2026-08-20 — mobile has its own project now; see the update below. US
hosting is unchanged.)*

**Update (2026-08-14):** Decision 7's "local/staging-only initially" gate is superseded —
`production` is now an approved capture environment (shared `isAnalyticsCaptureApproved` gate in
`analytics.ts`), per explicit owner direction. Before flipping this, call sites were re-audited:
`captureError` is only called from `app-error-boundary.tsx` (the top-level React error boundary)
and `client.ts`'s API contract-drift path (already fixed-string `ApiError`, no interpolation, by
design per this doc). A repo-wide scan for `throw new Error(\`...\`)` template interpolation found
only HTTP status codes and i18n key names — no amount/email/account-identifier interpolation
reaches a thrown `Error`, so nothing currently reaching the error boundary is known to carry PII.
This does not relax Decisions 1-6 (no Session Replay, mandatory `beforeSend` scrub, no user
context, no custom tags/extra, fixed-string messages) — those remain the actual safety mechanism;
only the environment gate widened. The App Privacy / Data Safety answers in
`secrets/store-compliance-answers.md` that declared "no diagnostics/usage data collected" are now
stale and must be corrected before the next store submission — Sentry is live in production.

**Update (2026-08-20):** Decision 8's DSN reuse is superseded — mobile now has its own Sentry
project, `wonder-money/mobile`, DSN
`https://397525327286be42f3f2f5d7cc89ac28@o438497.ingest.us.sentry.io/4511944590622720`.
Decision 8 anticipated this ("to keep mobile crash volume from diluting web's dashboards") and it
is what happened: on 2026-08-20 two mobile errors — `ApiError: The server response was invalid.`
(`src/lib/api/errors.ts`) and `TypeError: undefined is not a function`
(`src/features/goals/goals-contract.ts`) — were sitting in web's issue list attributed to web,
which is two of the three issues web had open that week. Web's error numbers were not web's.

**The open question is still open, not resolved.** A Sentry data region is fixed per *organization*,
and `wonder-money` is US-hosted, so a new project inside it is also US-hosted. Mobile crash data
still lives in the US while PostHog analytics lives in the EU. Closing that gap would require a
separate EU Sentry org — a materially bigger change than this one, and not undertaken here. The
mismatch remains accepted on the same terms as the original approval.

`app.config.ts`'s Sentry plugin `project` slug and `error-reporting.ts`'s `SENTRY_DSN` must move
together: they point at the same project for a reason, and a mismatch uploads source maps to one
project while events land in another, costing symbolication silently.

## Why this exists

Same standing blocker as PostHog: no mobile telemetry ADR has ever existed, and the Sentry work's own
"Analytics/error tracking" instinct ("no secrets in logs") needs to become an enforced rule
rather than a hope. Unlike PostHog, there is no existing mobile code with a documented gap
comment for this — Sentry has never been referenced anywhere in `src/`.

## Web is not a safe template here either

The Sentry work's scope note doesn't tell implementers to copy web, but it's worth stating plainly since
someone will otherwise look at `web-bak/sentry.client.config.ts` for reference the way the PostHog
work's author correctly looked at web's PostHog usage:

- **No `beforeSend`/`beforeBreadcrumb` scrubbing exists at all.** Whatever Sentry's SDK defaults
  capture — variable values interpolated into error messages, request/response bodies via HTTP
  breadcrumbs, console log breadcrumbs — ships unfiltered.
- **Session Replay is enabled** (`replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate:
  1.0`) with `maskAllText: true, blockAllMedia: true`. Text-masking heuristics are not
  guaranteed to catch every render path — a balance or amount rendered inside a custom chart,
  canvas, or SVG (this app has several — `portfolio-performance-chart.tsx`,
  `net-worth-history` charts) is not "text" a DOM/view-tree masker necessarily recognizes.
  Recording screen video of a financial app is a materially different risk than recording
  breadcrumbs and stack traces.
- **DSN is US-hosted** (`us.sentry.io`), inconsistent with the EU hosting mobile already
  committed to for PostHog. That inconsistency already exists in web's own setup between its two
  vendors; this ADR doesn't need to fix web's, only decide mobile's.

## Decision

1. **No Session Replay.** Not sampled at any rate, not even error-triggered. This is the single
   biggest divergence from web's setup and the reason this needed its own ADR rather than
   inheriting web's config. Revisit only with an explicit, separate proposal if there's a real
   debugging need that can't be met by breadcrumbs + stack traces.
2. **`beforeSend` is mandatory, not optional configuration.** Every event passes through a scrub
   function before leaving the device. At minimum it must strip: request/response bodies and
   Authorization/cookie headers from HTTP breadcrumbs, the `extra`/`contexts` Sentry attaches by
   default from React Native's error boundary (component stack can contain prop values), and any
   breadcrumb whose category is `console` (log statements could contain anything — this app's
   own "no `console.log` in production source" discipline, confirmed clean during an earlier
   audit, makes this mostly a defense-in-depth measure, not a response to a known leak).
3. **No automatic user context.** `Sentry.setUser()` is not called with anything — no email, no
   Supabase user ID, no device-linked identifier. If a crash needs to be correlated to a specific
   user's report, that happens through the existing support-mail channel
   (`link-policy.ts`), not through Sentry's own identity linking. Same posture as the PostHog
   ADR's "no `identify()` carrying PII."
4. **No custom `tags`/`contexts`/`extra` at call sites.** `Sentry.captureException(error)` with
   no second argument, everywhere. A well-meaning `Sentry.captureException(error, { extra: {
   accountId } })` at some future call site is exactly the kind of one-off leak an allowlist
   approach in the PostHog ADR exists to prevent; the equivalent guard here is "the call signature this
   app uses takes no context," enforced by the same kind of thin wrapper module built for
   PostHog (see Implementation notes) rather than trusting every future call site to remember.
5. **Error *messages* are not free-text-safe by construction.** Scrubbing breadcrumbs and
   context doesn't help if the thrown error's own `.message` string was built by interpolating a
   value (`` `Invalid amount: ${amount}` ``). This app's existing pattern
   (`supabase-auth-adapter.ts` converts every provider error into a bare `{status}` before it
   propagates, never rethrowing the original) is the model — audit this before enabling Sentry;
   it's not free.
6. **Source maps upload on release build**, per the Sentry work's existing acceptance criteria —
   this is the one part of its original scope this ADR doesn't need to re-decide, only confirm.
7. **Local/staging-only initially**, same gate and same reasoning as the PostHog ADR (mirror
   `isAnalyticsCaptureApproved`'s shape, or literally reuse it if a shared "is this an approved
   telemetry environment" check makes sense — implementer's call, not this ADR's).
8. **DSN reuse: propose reusing web's DSN**, following the same reasoning already accepted for
   PostHog (a Sentry DSN is a write-only ingest identifier, not a secret) — flagged explicitly
   here in case the answer differs from PostHog's on review; it wasn't asked twice by assumption.
   DSN: `https://53bebffb6dbd48fe802ec2f64d0d98b7@o438497.ingest.us.sentry.io/6598171` (from
   `web-bak/sentry.client.config.ts`). If a separate mobile Sentry project is wanted instead —
   e.g. to keep mobile crash volume from diluting web's dashboards, or to allow the EU-hosting
   correction below without touching web — strike this line and say so.
9. **Sampling**: `tracesSampleRate: 0` initially (no performance tracing — it's a separate
   feature from crash reporting and wasn't asked for; enable deliberately later if wanted, not
   as a side effect of turning on crash reporting).

## Open question this ADR is flagging, not deciding

Web's DSN is US-hosted; PostHog's approved mobile config is EU-hosted. Reusing web's DSN means
accepting US hosting for mobile crash data despite the EU choice made for analytics. This is a
real inconsistency, not an oversight in this document — resolving it either means accepting the
mismatch (crash data location differs from analytics data location) or creating a mobile-specific
EU Sentry project instead of reusing web's. Pick one explicitly in the approval section below.

## Implementation notes (non-binding, for whoever implements this)

Mirror the PostHog adapter's shape: a small `src/lib/telemetry/` module that never lets `@sentry/react-native`
leak outside a single adapter file, a `captureError(error: unknown): void` function with no second
parameter (so there's no `extra`/`tags` argument to misuse), and `beforeSend`/integration
configuration co-located with that adapter the same way `posthog-analytics-client.ts` co-locates
PostHog's feature-disabling options with its client construction.

## Consequences

- Crash/error visibility will be thinner than web's for a while — no session replay, no request
  bodies in breadcrumbs, no custom context at call sites. Same intended trade-off as the PostHog
  ADR: conservative first, widen deliberately and explicitly.
- If error messages elsewhere in the codebase aren't already PII-safe by construction (unlike
  the auth adapter), turning Sentry on will surface that gap immediately in the Sentry dashboard
  rather than in a privacy incident — implementers should treat a message that reveals PII in
  the Sentry test-capture step as a bug in the *source* code, not something to patch in
  `beforeSend`.

## Approval

- [x] Reviewed and approved as-is
- [x] DSN decision: reuse web's US-hosted DSN — *superseded 2026-08-20, own project `wonder-money/mobile`, still US-hosted*
- Approved by: the maintainer (chat-session record)  Date: 2026-08-12
- Edits made before approval: none
