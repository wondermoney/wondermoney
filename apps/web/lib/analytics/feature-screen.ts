import type { WebFeatureScreen } from "@wondermoney/shared/analytics";

/**
 * Each web route as its `feature_screen_viewed` identifier (`webFeatureScreens` in the event
 * catalogue), matched against the pathname without its locale. The identifier names the
 * screen, never the path: `/accounts/123` is `account_detail`. `null` is a route that is
 * deliberately not counted. `feature-screen.test.ts` walks `app/` and fails when a route
 * matches nothing here.
 */
const SCREENS: readonly (readonly [RegExp, WebFeatureScreen | null])[] = [
  [/^\/$/u, "dashboard"],
  [/^\/home$/u, "dashboard"],
  [/^\/auth\/login$/u, "sign_in"],
  [/^\/auth\/mfa$/u, "sign_in_mfa"],
  [/^\/auth\/auth-code-error$/u, "sign_in_error"],
  [/^\/auth\/signup$/u, "sign_up"],
  // A new server's first-run setup is its first sign-up.
  [/^\/setup$/u, "sign_up"],
  [/^\/auth\/forgot$/u, "forgot_password"],
  [/^\/auth\/reset$/u, "reset_password"],
  [/^\/join$/u, "settings_household_join"],
  [/^\/oauth\/consent$/u, "oauth_consent"],
  [/^\/faq$/u, "faq"],
  [/^\/onboarding(?:\/[^/]+)?$/u, "onboarding"],
  [/^\/accounts$/u, "accounts"],
  [/^\/accounts\/recurring$/u, "recurring"],
  [/^\/accounts\/transactions$/u, "transactions"],
  [/^\/accounts\/transactions\/review$/u, "transaction_review"],
  [/^\/accounts\/installment-plans\/[^/]+$/u, "installment_plan_detail"],
  [/^\/accounts\/[^/]+$/u, "account_detail"],
  [/^\/accounts\/[^/]+\/transactions$/u, "account_transactions"],
  [/^\/budgets$/u, "budgets"],
  [/^\/budgets\/wizard(?:\/[^/]+)?$/u, "budget_create"],
  [/^\/budgets\/[^/]+\/[^/]+$/u, "budget_year"],
  [/^\/budgets\/[^/]+\/[^/]+\/[^/]+$/u, "budget_month"],
  [/^\/loans$/u, "loans"],
  [/^\/loans\/[^/]+$/u, "loan_detail"],
  [/^\/assets$/u, "assets"],
  [/^\/assets\/[^/]+$/u, "asset_detail"],
  [/^\/goals$/u, "goals"],
  [/^\/goals\/[^/]+$/u, "goal_detail"],
  [/^\/groups$/u, "expense_groups"],
  [/^\/groups\/[^/]+$/u, "expense_group_detail"],
  [/^\/financial-markets$/u, "markets"],
  [/^\/financial-markets\/explorer$/u, "market_screener"],
  [/^\/financial-markets\/watchlist$/u, "market_watchlist"],
  [/^\/portfolio$/u, "portfolio"],
  [/^\/portfolio\/transactions$/u, "portfolio_activity"],
  [/^\/portfolio\/[^/]+$/u, "portfolio_detail"],
  [/^\/portfolio\/[^/]+\/transactions$/u, "portfolio_detail_activity"],
  [/^\/portfolio\/[^/]+\/holdings$/u, "portfolio_holdings"],
  [/^\/reports$/u, "reports"],
  [/^\/settings$/u, "settings"],
  // The operators' bank sync console: not part of the product.
  [/^\/admin(?:\/.*)?$/u, null],
];

/**
 * The screen a pathname shows, without its locale (`usePathname` from `@/i18n/navigation`), or
 * `null` for a route that is not counted or not known (a not-found page).
 */
export function resolveFeatureScreen(pathname: string): WebFeatureScreen | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  for (const [pattern, screen] of SCREENS) {
    if (pattern.test(path)) return screen;
  }
  return null;
}
