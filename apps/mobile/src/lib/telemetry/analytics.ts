/**
 * Product analytics boundary, bound by `docs/telemetry-adr.md`.
 *
 * The ADR is the spec, not a guideline: event names come from a closed allowlist
 * and every property on every event is enumerated there. This module is the
 * technical safeguard the ADR is counting on — `AnalyticsCaptureArgs` is a
 * discriminated union over exactly the nine approved events, so an event name or
 * a property shape that is not on the allowlist is a compile error at the call
 * site rather than a code-review question.
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

/** Fixed by decision, not configuration: this app's only approved ingest host. */
export const POSTHOG_HOST = 'https://eu.posthog.com'

export type AnalyticsAuthProvider = 'email' | 'apple' | 'google'
export type AnalyticsAccountMethod = 'manual' | 'bank_connection'
export type AnalyticsFeedbackCategory = 'bug' | 'feature_request' | 'other'

/**
 * Closed enum of route identifiers for `feature_screen_viewed`. Derived from the
 * real `src/app` route tree, but deliberately *not* the route paths themselves:
 * a path like `/portfolio/abc123` round-trips to a specific portfolio, so only
 * the identifier (`portfolio_detail`) is ever sent. Routes that resolve to no
 * identifier are simply not captured — see `resolveFeatureScreen`.
 */
export const featureScreens = [
  // Unauthenticated
  'sign_in',
  'sign_up',
  'forgot_password',
  'reset_password',
  'access_blocked',
  // Activation
  'onboarding',
  'onboarding_create_account',
  // Tabs
  'dashboard',
  'accounts',
  'goals',
  'portfolio',
  'more',
  // Accounts & transactions
  'account_detail',
  'account_edit',
  'account_transactions',
  'account_create',
  'recurring',
  'transactions',
  'transaction_create',
  'transaction_import',
  'transaction_scan',
  // Budgets
  'budgets',
  'budget_create',
  'budget_accounts',
  'budget_edit',
  'budget_add_category',
  'budget_year',
  'budget_month',
  // Loans
  'loans',
  'loan_create',
  'loan_detail',
  'loan_edit',
  // Goals
  'goal_detail',
  'goal_create',
  'debt_strategy',
  // Markets
  'markets',
  'market_detail',
  'market_screener',
  'market_watchlist',
  // Banking
  'bank_connections',
  'bank_connect',
  'bank_statement_import',
  // Net worth
  'net_worth_history',
  // Portfolio
  'portfolio_create',
  'portfolio_activity',
  'portfolio_detail',
  'portfolio_detail_activity',
  'portfolio_import',
  'portfolio_settings',
  'portfolio_transaction_create',
  'portfolio_holding_detail',
  // Reports
  'reports',
  'report_budget_vs_actual',
  'report_cashflow',
  'report_net_worth_history',
  'report_portfolio_performance',
  'report_sankey',
  'report_spending_by_category',
  // Settings
  'settings_categories',
  'settings_category_create',
  'settings_category_edit',
  'settings_household',
  'settings_notifications',
  'settings_preferences',
  'settings_profile',
  'settings_profile_edit',
  'settings_security',
] as const

export type FeatureScreen = (typeof featureScreens)[number]

/**
 * The allowlist itself. `never` means "this event takes no properties" and the
 * capture signature below turns that into a one-argument call.
 */
type AllowlistedEvents = {
  sign_up_completed: { provider: AnalyticsAuthProvider }
  sign_in_completed: { provider: AnalyticsAuthProvider }
  onboarding_completed: never
  first_account_created: { method: AnalyticsAccountMethod }
  bank_connection_started: never
  bank_connection_completed: never
  bank_connection_failed: never
  feedback_submitted: { category: AnalyticsFeedbackCategory }
  feature_screen_viewed: { screen: FeatureScreen }
}

export type AnalyticsEvent = keyof AllowlistedEvents

/**
 * Argument tuples for `capture`, one per allowlisted event. Because the property
 * type is the exact object type for that event, TypeScript's excess-property
 * check rejects an extra key on an object literal — that is what keeps a
 * well-meaning `{ provider: 'email', userId }` from ever compiling.
 */
export type AnalyticsCaptureArgs = {
  [E in AnalyticsEvent]: [AllowlistedEvents[E]] extends [never]
    ? [event: E]
    : [event: E, properties: AllowlistedEvents[E]]
}[AnalyticsEvent]

/**
 * The vendor seam. Property values are constrained to strings because every
 * approved property is a closed string enum; a number or an object cannot be
 * passed through this port even by an adapter.
 */
export type AnalyticsClientPort = Readonly<{
  capture: (event: AnalyticsEvent, properties?: Readonly<Record<string, string>>) => void
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
