import { renderHook } from '@testing-library/react-native'
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

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
    ['/more/banking/simplefin/connect', 'bank_connect_simplefin'],
    ['/reports/spending-by-category', 'report_spending_by_category'],
    ['/reports/month-comparison', 'report_month_comparison'],
    ['/settings/profile/edit', 'settings_profile_edit'],
    ['/net-worth/history', 'net_worth_history'],
    ['/home/customize', 'home_customize'],
    ['/more/banking/history', 'bank_sync_history'],
    ['/more/pending-changes', 'pending_changes'],
    ['/settings/rules', 'settings_rules'],
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
    ['/assets/as_4/edit', 'asset_edit'],
    ['/accounts/8142/installments/plan_5', 'installment_plan_detail'],
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
    ['/accounts/8142/installments/create', 'installment_plan_create'],
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

/**
 * The route tree itself, walked from disk, so a screen added later without an
 * identifier fails here instead of silently recording no view. Each route file
 * becomes the pathname expo-router would report for it: groups such as `(app)`
 * drop out, `index` is its folder, and every `[param]` gets a recognisable
 * stand-in value so a leak of it into the payload is easy to spot.
 */
const APP_DIR = join(__dirname, '..', '..', 'app')
const DYNAMIC_MARKER = 'leak7f3a'

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    // `_layout` wraps routes and `+native-intent` rewrites links; neither is a screen.
    if (entry.name.startsWith('_') || entry.name.startsWith('+')) return []
    return [path]
  })
}

function toPathname(file: string): { pathname: string; dynamic: boolean } {
  const segments = relative(APP_DIR, file)
    .replace(/\.tsx?$/, '')
    .split(sep)
    .filter((segment) => !/^\(.+\)$/.test(segment))
  if (segments.at(-1) === 'index') segments.pop()
  let dynamic = false
  const concrete = segments.map((segment) => {
    const param = /^\[(.+)\]$/.exec(segment)?.[1]
    if (param === undefined) return segment
    if (param.startsWith('...')) throw new Error(`catch-all route ${file} needs its own pattern handling`)
    dynamic = true
    return `${param}-${DYNAMIC_MARKER}`
  })
  return { pathname: `/${concrete.join('/')}`, dynamic }
}

const routes = routeFiles(APP_DIR).map((file) => ({ file: relative(APP_DIR, file), ...toPathname(file) }))

describe('every route in src/app', () => {
  it('finds the route tree', () => {
    expect(routes.length).toBeGreaterThan(50)
    expect(routes.some((route) => route.dynamic)).toBe(true)
  })

  it.each(routes.map((route) => [route.file, route.pathname] as const))(
    'has a screen identifier: %s',
    (_file, pathname) => {
      expect(resolveFeatureScreen(pathname)).not.toBeNull()
    },
  )

  it('gives distinct screens distinct identifiers', () => {
    const byScreen = new Map<string, string[]>()
    for (const route of routes) {
      const screen = resolveFeatureScreen(route.pathname) ?? 'unmapped'
      byScreen.set(screen, [...(byScreen.get(screen) ?? []), route.file])
    }
    const shared = [...byScreen].filter(([, files]) => files.length > 1)
    expect(shared).toEqual([])
  })

  it('leaves no identifier without a route', () => {
    const reached = new Set(routes.map((route) => resolveFeatureScreen(route.pathname)))
    expect(featureScreens.filter((screen) => !reached.has(screen))).toEqual([])
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

  it('keeps every dynamic segment of every route out of the payload', async () => {
    const dynamicRoutes = routes.filter((route) => route.dynamic)
    expect(dynamicRoutes.length).toBeGreaterThan(0)

    for (const route of dynamicRoutes) {
      captured.mockReset()
      mockUsePathname.mockReturnValue(route.pathname)

      const hook = await renderHook(() => useFeatureScreenAnalytics())

      expect(captured).toHaveBeenCalledTimes(1)
      const [event, properties] = captured.mock.calls[0] ?? []
      expect(event).toBe('feature_screen_viewed')
      expect(Object.keys(properties ?? {})).toEqual(['screen'])
      expect(JSON.stringify(captured.mock.calls)).not.toContain(DYNAMIC_MARKER)
      await hook.unmount()
    }
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
