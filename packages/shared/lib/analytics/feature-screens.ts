/**
 * Mobile's closed list of screen identifiers for `feature_screen_viewed`. Derived from the app's
 * route tree, but deliberately not the route paths: `/portfolio/abc123` names one portfolio, so
 * only the identifier (`portfolio_detail`) is sent. `apps/mobile`'s `screen-analytics.test.tsx`
 * fails when a route has no identifier or an identifier has no route.
 */
export const mobileFeatureScreens = [
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
  'home_customize',
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
  // Credit-card installment plans
  'installment_plan_create',
  'installment_plan_detail',
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
  // Expense groups
  'expense_groups',
  'expense_group_create',
  'expense_group_detail',
  // Manually valued assets
  'assets',
  'asset_create',
  'crypto_wallet_create',
  'asset_detail',
  'asset_edit',
  'asset_value',
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
  'bank_connect_simplefin',
  'bank_statement_import',
  'bank_sync_history',
  // Assistant proposals
  'pending_changes',
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
  'report_month_comparison',
  'report_net_worth_history',
  'report_portfolio_performance',
  'report_sankey',
  'report_spending_by_category',
  // Settings
  'settings_categories',
  'settings_category_create',
  'settings_category_edit',
  'settings_household',
  'settings_household_join',
  'settings_notifications',
  'settings_preferences',
  'settings_profile',
  'settings_profile_edit',
  'settings_rules',
  'settings_security',
] as const;

/**
 * Web's, the same way: a screen both apps have keeps mobile's identifier. `apps/web`'s
 * `lib/analytics/feature-screen.test.ts` fails when a route has no identifier or an identifier
 * has no route.
 */
export const webFeatureScreens = [
  // Unauthenticated
  'sign_in',
  'sign_in_mfa',
  'sign_in_error',
  'sign_up',
  'forgot_password',
  'reset_password',
  'settings_household_join',
  'faq',
  // Activation
  'onboarding',
  // Home
  'dashboard',
  // Accounts & transactions
  'accounts',
  'account_detail',
  'account_transactions',
  'installment_plan_detail',
  'recurring',
  'transactions',
  'transaction_review',
  // Budgets
  'budgets',
  'budget_create',
  'budget_year',
  'budget_month',
  // Loans, assets, goals, expense groups
  'loans',
  'loan_detail',
  'assets',
  'asset_detail',
  'goals',
  'goal_detail',
  'expense_groups',
  'expense_group_detail',
  // Markets
  'markets',
  'market_screener',
  'market_watchlist',
  // Portfolio
  'portfolio',
  'portfolio_activity',
  'portfolio_detail',
  'portfolio_detail_activity',
  'portfolio_holdings',
  // Reports and settings
  'reports',
  'settings',
] as const;

/** Every screen identifier, of both apps: the values of `feature_screen_viewed.screen`. */
export const featureScreens = [
  ...mobileFeatureScreens,
  ...webFeatureScreens.filter(
    (screen): screen is Exclude<WebFeatureScreen, MobileFeatureScreen> =>
      !(mobileFeatureScreens as readonly string[]).includes(screen),
  ),
] as const;

export type MobileFeatureScreen = (typeof mobileFeatureScreens)[number];
export type WebFeatureScreen = (typeof webFeatureScreens)[number];
export type FeatureScreen = MobileFeatureScreen | WebFeatureScreen;
