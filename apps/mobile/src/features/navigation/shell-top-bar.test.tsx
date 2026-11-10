import { I18nextProvider, useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { StyleSheet, Text } from 'react-native'
import { router, Slot } from 'expo-router'
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library'

import AuthenticatedLayout from '@/app/(app)/_layout'
import { currentPage, currentSection, showsTopBar } from '@/components/shell/navigation'
import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { ProductNavigation } from './product-navigation'

jest.mock('@/components/providers/authenticated-route-boundary', () => ({
  AuthenticatedRouteBoundary: ({ children }: { children: ReactNode }) => children,
}))

jest.mock('@/features/onboarding/onboarding-gate', () => ({
  OnboardingGate: ({ children }: { children: ReactNode }) => children,
}))

jest.mock('@/features/security/app-lock-gate', () => ({
  AppLockGate: ({ children }: { children: ReactNode }) => children,
}))

async function renderShell(initialUrl = '/') {
  const i18n = await initMobileI18n('en')
  const Root = () => <I18nextProvider i18n={i18n}><Slot /></I18nextProvider>
  const Layout = () => {
    const { t } = useTranslation()
    return <ProductNavigation labels={{ home: t('navigation.home'), accounts: t('navigation.accounts'), budgets: t('navigation.budgets'), portfolio: t('navigation.portfolio'), more: t('navigation.more') }} availableWidth={390} />
  }
  const rendered = await renderRouter({
    _layout: Root,
    '(app)/_layout': AuthenticatedLayout,
    '(app)/(tabs)/_layout': Layout,
    '(app)/(tabs)/index': () => <Text>home screen</Text>,
    '(app)/(tabs)/accounts': () => <Text>accounts screen</Text>,
    '(app)/(tabs)/budgets': () => <Text>budgets screen</Text>,
    '(app)/(tabs)/portfolio': () => <Text>portfolio screen</Text>,
    '(app)/(tabs)/more': () => <Text>more screen</Text>,
    '(app)/accounts/transactions': () => <Text>transactions screen</Text>,
    '(app)/accounts/recurring': () => <Text>recurring screen</Text>,
    '(app)/accounts/create': () => <Text>create account screen</Text>,
    '(app)/accounts/[accountId]': () => <Text>account detail screen</Text>,
  }, { initialUrl })
  return { getPathname: rendered.getPathname }
}

describe('shell navigation model', () => {
  it('matches web: the longest page href wins inside a section', () => {
    const accounts = currentSection('/accounts/42')!
    expect(accounts.id).toBe('accounts')
    expect(currentPage(accounts, '/accounts/42')?.id).toBe('accounts.overview')
    expect(currentPage(accounts, '/accounts/transactions')?.id).toBe('accounts.transactions')
    expect(currentPage(currentSection('/markets/watchlist')!, '/markets/watchlist')?.id).toBe('financial-markets.watchlist')
    expect(currentSection('/budgets')).toBeUndefined()
    expect(currentSection('/')).toBeUndefined()
  })

  it('keeps the bar off flow routes only', () => {
    for (const path of ['/', '/accounts', '/accounts/42', '/accounts/transactions', '/goals/3', '/settings/preferences', '/settings/security', '/portfolio/7', '/portfolio/7/activity', '/budgets/2/2026']) {
      expect(showsTopBar(path)).toBe(true)
    }
    for (const path of ['/accounts/create', '/accounts/42/edit', '/accounts/transactions/import', '/budgets/create', '/portfolio/7/transaction-create', '/more/banking/connect', '/budgets/2/accounts', '/portfolio/7/settings', '/budgets/2/categories/add', '/loans/3/edit', '/settings/profile/edit', '/settings/categories/create', '/settings/categories/9/edit', '/portfolio/7/import']) {
      expect(showsTopBar(path)).toBe(false)
    }
  })
})

describe('ShellTopBar', () => {
  it('shows the wordmark and the person menu on a tab screen, with no section tabs on Home', async () => {
    await renderShell('/')
    expect(screen.getByTestId('app-top-bar')).toBeOnTheScreen()
    expect(screen.getByRole('link', { name: 'Home' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Open user menu' })).toBeOnTheScreen()
    expect(screen.queryByTestId('section-tabs')).not.toBeOnTheScreen()
    expect(StyleSheet.flatten(screen.getByTestId('app-top-bar').props.style).borderBottomWidth).toBe(1)
  })

  it('shows the Accounts pages as underlined tabs with web\'s labels', async () => {
    await renderShell('/accounts')
    const tabs = screen.getByTestId('section-tabs')
    expect(within(tabs).getAllByRole('link').map((link) => within(link).getByText(/.+/).props.children)).toEqual([
      'Overview',
      'Transactions',
      'Bills & subscriptions',
    ])
    expect(screen.getByTestId('section-tab-accounts.overview').props.accessibilityState).toMatchObject({ selected: true })
    // Section tabs are links, so the bottom bar stays the only tab list.
    expect(screen.getAllByRole('tab')).toHaveLength(5)
  })

  it('moves between section pages and back to the tab root', async () => {
    const rendered = await renderShell('/accounts')
    await fireEvent.press(screen.getByTestId('section-tab-accounts.transactions'))
    expect(rendered.getPathname()).toBe('/accounts/transactions')
    expect(screen.getByTestId('section-tab-accounts.transactions').props.accessibilityState).toMatchObject({ selected: true })
    await fireEvent.press(screen.getByTestId('section-tab-accounts.recurring'))
    expect(rendered.getPathname()).toBe('/accounts/recurring')
    await fireEvent.press(screen.getByTestId('section-tab-accounts.overview'))
    expect(rendered.getPathname()).toBe('/accounts')
    expect(screen.getByText('accounts screen')).toBeOnTheScreen()
  })

  it('keeps the bar on a detail page and hides it on a flow', async () => {
    await renderShell('/')
    await act(() => router.navigate('/accounts/42'))
    expect(screen.getByTestId('app-top-bar')).toBeOnTheScreen()
    await act(() => router.navigate('/accounts/create'))
    expect(screen.getByText('create account screen')).toBeOnTheScreen()
    expect(screen.queryByTestId('app-top-bar')).not.toBeOnTheScreen()
  })

  it('opens the person menu with settings, appearance, sign out', async () => {
    await renderShell('/')
    await fireEvent.press(screen.getByRole('button', { name: 'Open user menu' }))
    const menu = screen.getByTestId('person-menu')
    for (const name of ['Settings', 'Appearance & Language', 'Help', 'Sign out']) {
      const row = within(menu).getByRole('button', { name })
      expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(themeTokens.touchTarget.minimum)
    }
  })
})
