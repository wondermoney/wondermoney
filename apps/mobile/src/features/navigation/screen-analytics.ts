import { usePathname } from 'expo-router'
import { useEffect, useRef } from 'react'

import { captureAnalyticsEvent, type FeatureScreen } from '@/lib/telemetry/analytics'

/**
 * RAD-518 — `feature_screen_viewed`, the one engagement signal the telemetry ADR
 * approves, wired once at the root instead of a `useEffect` in seventy screen
 * files.
 *
 * The ADR is explicit that `screen` is "a closed enum of route identifiers,
 * never a raw path with IDs in it (e.g. `portfolio_detail`, not
 * `/portfolio/abc123`)". So this file is a translation table, not a pass-through:
 * a live pathname is matched against route *patterns*, and only the resulting
 * identifier is ever handed to `captureAnalyticsEvent`. A pathname that matches
 * no pattern captures nothing at all — failing closed is the whole point, and a
 * route added later simply produces no event until someone adds it here and to
 * `featureScreens`.
 */
type RoutePattern = readonly [segments: readonly string[], screen: FeatureScreen]

/** `*` matches exactly one dynamic segment (`[accountId]`, `[year]`, …). */
const WILDCARD = '*'

const routePatterns: readonly RoutePattern[] = [
  [[], 'dashboard'],
  [['sign-in'], 'sign_in'],
  [['sign-up'], 'sign_up'],
  [['forgot-password'], 'forgot_password'],
  [['reset-password'], 'reset_password'],
  [['access'], 'access_blocked'],
  [['onboarding'], 'onboarding'],
  [['onboarding', 'create-account'], 'onboarding_create_account'],

  [['accounts'], 'accounts'],
  [['goals'], 'goals'],
  [['portfolio'], 'portfolio'],
  [['more'], 'more'],

  [['accounts', 'create'], 'account_create'],
  [['accounts', 'recurring'], 'recurring'],
  [['accounts', 'transactions'], 'transactions'],
  [['accounts', 'transactions', 'create'], 'transaction_create'],
  [['accounts', 'transactions', 'import'], 'transaction_import'],
  [['accounts', 'transactions', 'scan'], 'transaction_scan'],
  [['accounts', WILDCARD], 'account_detail'],
  [['accounts', WILDCARD, 'edit'], 'account_edit'],
  [['accounts', WILDCARD, 'transactions'], 'account_transactions'],

  [['budgets'], 'budgets'],
  [['budgets', 'create'], 'budget_create'],
  [['budgets', WILDCARD, 'accounts'], 'budget_accounts'],
  [['budgets', WILDCARD, 'edit'], 'budget_edit'],
  [['budgets', WILDCARD, 'categories', 'add'], 'budget_add_category'],
  [['budgets', WILDCARD, WILDCARD], 'budget_year'],
  [['budgets', WILDCARD, WILDCARD, WILDCARD], 'budget_month'],

  [['loans'], 'loans'],
  [['loans', 'create'], 'loan_create'],
  [['loans', WILDCARD], 'loan_detail'],
  [['loans', WILDCARD, 'edit'], 'loan_edit'],

  [['goals', 'create'], 'goal_create'],
  [['goals', 'debt-strategy'], 'debt_strategy'],
  [['goals', WILDCARD], 'goal_detail'],

  [['markets'], 'markets'],
  [['markets', 'screener'], 'market_screener'],
  [['markets', 'watchlist'], 'market_watchlist'],
  [['markets', WILDCARD], 'market_detail'],

  [['more', 'banking'], 'bank_connections'],
  [['more', 'banking', 'connect'], 'bank_connect'],
  [['more', 'banking', 'import'], 'bank_statement_import'],

  [['net-worth', 'history'], 'net_worth_history'],

  [['portfolio', 'create'], 'portfolio_create'],
  [['portfolio', 'activity'], 'portfolio_activity'],
  [['portfolio', WILDCARD], 'portfolio_detail'],
  [['portfolio', WILDCARD, 'activity'], 'portfolio_detail_activity'],
  [['portfolio', WILDCARD, 'import'], 'portfolio_import'],
  [['portfolio', WILDCARD, 'settings'], 'portfolio_settings'],
  [['portfolio', WILDCARD, 'transaction-create'], 'portfolio_transaction_create'],
  [['portfolio', WILDCARD, 'holding', WILDCARD], 'portfolio_holding_detail'],

  [['reports'], 'reports'],
  [['reports', 'budget-vs-actual'], 'report_budget_vs_actual'],
  [['reports', 'cashflow'], 'report_cashflow'],
  [['reports', 'net-worth-history'], 'report_net_worth_history'],
  [['reports', 'portfolio-performance'], 'report_portfolio_performance'],
  [['reports', 'sankey'], 'report_sankey'],
  [['reports', 'spending-by-category'], 'report_spending_by_category'],

  [['settings', 'categories'], 'settings_categories'],
  [['settings', 'categories', 'create'], 'settings_category_create'],
  [['settings', 'categories', WILDCARD, 'edit'], 'settings_category_edit'],
  [['settings', 'household'], 'settings_household'],
  [['settings', 'notifications'], 'settings_notifications'],
  [['settings', 'preferences'], 'settings_preferences'],
  [['settings', 'profile'], 'settings_profile'],
  [['settings', 'profile', 'edit'], 'settings_profile_edit'],
  [['settings', 'security'], 'settings_security'],
]

function toSegments(pathname: string): readonly string[] | null {
  const [path] = pathname.split('?')
  if (path === undefined || !path.startsWith('/')) return null
  return path.split('/').filter((segment) => segment.length > 0)
}

/**
 * Resolves a live pathname to its allowlisted identifier, or `null` when the
 * route is not on the allowlist. Literal segments outrank wildcards, so
 * `/accounts/create` is `account_create` and never `account_detail`, regardless
 * of the order patterns happen to appear in above.
 */
export function resolveFeatureScreen(pathname: string): FeatureScreen | null {
  const segments = toSegments(pathname)
  if (segments === null) return null

  let best: FeatureScreen | null = null
  let bestLiterals = -1

  for (const [pattern, screen] of routePatterns) {
    if (pattern.length !== segments.length) continue
    let literals = 0
    let matched = true
    for (const [index, expected] of pattern.entries()) {
      if (expected === WILDCARD) continue
      if (expected !== segments[index]) {
        matched = false
        break
      }
      literals += 1
    }
    if (matched && literals > bestLiterals) {
      best = screen
      bestLiterals = literals
    }
  }

  return best
}

/**
 * Captures one `feature_screen_viewed` per distinct allowlisted screen the user
 * lands on. Deduped by the resolved identifier rather than the pathname, so
 * moving between two portfolios does not report two views of `portfolio_detail`
 * — the identifier is all the ADR approves us to know, so it is also all we can
 * honestly distinguish.
 */
export function useFeatureScreenAnalytics(): void {
  const pathname = usePathname()
  const lastCaptured = useRef<FeatureScreen | null>(null)

  useEffect(() => {
    const screen = resolveFeatureScreen(pathname)
    if (screen === null || screen === lastCaptured.current) return
    lastCaptured.current = screen
    captureAnalyticsEvent('feature_screen_viewed', { screen })
  }, [pathname])
}
