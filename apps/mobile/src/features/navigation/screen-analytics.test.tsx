import { renderHook } from '@testing-library/react-native'

import { captureAnalyticsEvent, featureScreens } from '@/lib/telemetry/analytics'

import { resolveFeatureScreen, useFeatureScreenAnalytics } from './screen-analytics'

const mockUsePathname = jest.fn<string, []>()
jest.mock('expo-router', () => ({ usePathname: () => mockUsePathname() }))
jest.mock('@/lib/telemetry/analytics', () => ({
  ...jest.requireActual<typeof import('@/lib/telemetry/analytics')>('@/lib/telemetry/analytics'),
  captureAnalyticsEvent: jest.fn(),
}))

const captured = jest.mocked(captureAnalyticsEvent)

describe('resolveFeatureScreen', () => {
  it.each([
    ['/', 'dashboard'],
    ['/sign-in', 'sign_in'],
    ['/sign-up', 'sign_up'],
    ['/onboarding', 'onboarding'],
    ['/onboarding/create-account', 'onboarding_create_account'],
    ['/accounts', 'accounts'],
    ['/goals', 'goals'],
    ['/portfolio', 'portfolio'],
    ['/more', 'more'],
    ['/more/banking', 'bank_connections'],
    ['/more/banking/connect', 'bank_connect'],
    ['/reports/spending-by-category', 'report_spending_by_category'],
    ['/settings/profile/edit', 'settings_profile_edit'],
    ['/net-worth/history', 'net_worth_history'],
  ])('maps the static route %p to %p', (pathname, screen) => {
    expect(resolveFeatureScreen(pathname)).toBe(screen)
  })

  it.each([
    ['/accounts/8142', 'account_detail'],
    ['/accounts/8142/edit', 'account_edit'],
    ['/accounts/8142/transactions', 'account_transactions'],
    ['/budgets/b_9/2026', 'budget_year'],
    ['/budgets/b_9/2026/03', 'budget_month'],
    ['/budgets/b_9/categories/add', 'budget_add_category'],
    ['/loans/c_1/edit', 'loan_edit'],
    ['/goals/g_1', 'goal_detail'],
    ['/markets/AAPL', 'market_detail'],
    ['/portfolio/abc123', 'portfolio_detail'],
    ['/portfolio/abc123/holding/asset_7', 'portfolio_holding_detail'],
    ['/settings/categories/cat_3/edit', 'settings_category_edit'],
  ])('reduces the identifier-bearing route %p to %p', (pathname, screen) => {
    expect(resolveFeatureScreen(pathname)).toBe(screen)
  })

  it.each([
    ['/accounts/create', 'account_create'],
    ['/accounts/transactions', 'transactions'],
    ['/accounts/transactions/create', 'transaction_create'],
    ['/goals/create', 'goal_create'],
    ['/goals/debt-strategy', 'debt_strategy'],
    ['/loans/create', 'loan_create'],
    ['/markets/screener', 'market_screener'],
    ['/portfolio/create', 'portfolio_create'],
    ['/portfolio/activity', 'portfolio_activity'],
  ])('prefers the literal route %p over the dynamic one at the same depth', (pathname, screen) => {
    expect(resolveFeatureScreen(pathname)).toBe(screen)
  })

  it.each(['/nope', '/accounts/8142/unknown-tab', 'accounts', '', '/settings'])(
    'resolves nothing for the unmapped route %p rather than guessing',
    (pathname) => {
      expect(resolveFeatureScreen(pathname)).toBeNull()
    },
  )

  it('only ever answers with an allowlisted identifier', () => {
    const allowed = new Set<string>(featureScreens)
    for (const pathname of ['/', '/portfolio/abc123', '/budgets/b_9/2026/03', '/settings/security']) {
      const screen = resolveFeatureScreen(pathname)
      expect(screen).not.toBeNull()
      expect(allowed.has(screen as string)).toBe(true)
    }
  })
})

describe('useFeatureScreenAnalytics', () => {
  beforeEach(() => {
    captured.mockReset()
    mockUsePathname.mockReset()
  })

  it('captures the identifier for the screen the user landed on, never the path', async () => {
    mockUsePathname.mockReturnValue('/portfolio/abc123')

    const hook = await renderHook(() => useFeatureScreenAnalytics())

    expect(captured).toHaveBeenCalledTimes(1)
    expect(captured).toHaveBeenCalledWith('feature_screen_viewed', { screen: 'portfolio_detail' })
    expect(JSON.stringify(captured.mock.calls)).not.toContain('abc123')
    hook.unmount()
  })

  it('captures nothing for a route that is not on the allowlist', async () => {
    mockUsePathname.mockReturnValue('/accounts/8142/unknown-tab')

    const hook = await renderHook(() => useFeatureScreenAnalytics())

    expect(captured).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('reports one view per screen, not one per resource', async () => {
    mockUsePathname.mockReturnValue('/portfolio/abc123')
    const hook = await renderHook(() => useFeatureScreenAnalytics())

    mockUsePathname.mockReturnValue('/portfolio/def456')
    await hook.rerender(undefined)
    expect(captured).toHaveBeenCalledTimes(1)

    mockUsePathname.mockReturnValue('/reports')
    await hook.rerender(undefined)
    expect(captured).toHaveBeenCalledTimes(2)
    expect(captured).toHaveBeenLastCalledWith('feature_screen_viewed', { screen: 'reports' })
    hook.unmount()
  })
})
