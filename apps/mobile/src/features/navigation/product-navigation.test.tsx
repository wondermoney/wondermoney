import { I18nextProvider, useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { StyleSheet, Text } from 'react-native'
import { router, Slot } from 'expo-router'
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library'

import AuthenticatedLayout from '@/app/(app)/_layout'
import { initMobileI18n } from '@/lib/i18n'

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

async function renderShell(width: number, locale = 'en') {
  const i18n = await initMobileI18n(locale)
  const Root = () => <I18nextProvider i18n={i18n}><Slot /></I18nextProvider>
  const Layout = () => {
    const { t } = useTranslation()
    return <ProductNavigation labels={{ home: t('navigation.home'), accounts: t('navigation.accounts'), budgets: t('navigation.budgets'), portfolio: t('navigation.portfolio'), more: t('navigation.more') }} availableWidth={width} />
  }
  const router = renderRouter({
    _layout: Root,
    '(app)/_layout': AuthenticatedLayout,
    '(app)/(tabs)/_layout': Layout,
    '(app)/(tabs)/index': () => <Text>home screen</Text>,
    '(app)/(tabs)/accounts': () => <Text>accounts screen</Text>,
    '(app)/(tabs)/budgets': () => <Text>budgets screen</Text>,
    '(app)/goals/index': () => <Text>goals screen</Text>,
    '(app)/(tabs)/portfolio': () => <Text>portfolio screen</Text>,
    '(app)/(tabs)/more': () => <Text>more screen</Text>,
    '(app)/accounts/[accountId]': () => <Text>account detail screen</Text>,
    '(app)/portfolio/[portfolioId]': () => <Text>portfolio detail screen</Text>,
    '(app)/settings/profile': () => <Text>profile screen</Text>,
    '(app)/settings/subscription-status': () => <Text>subscription screen</Text>,
  }, { initialUrl: '/' })
  await router
  return { getPathname: router.getPathname }
}

describe('ProductNavigation', () => {
  it('renders exactly five narrow tabs and follows router selection', async () => {
    const router = await renderShell(320)
    const bar = screen.getByTestId('product-bottom-bar')
    expect(within(bar).getAllByRole('tab')).toHaveLength(5)
    expect(screen.queryByTestId('product-rail')).not.toBeOnTheScreen()
    expect(screen.getByRole('tab', { name: 'Home' }).props.accessibilityState).toMatchObject({ selected: true })
    for (const label of ['Home', 'Accounts', 'Budgets', 'Portfolio', 'More']) {
      const target = within(bar).getByRole('tab', { name: label })
      const style = StyleSheet.flatten(target.props.style)
      expect(style.minHeight).toBeGreaterThanOrEqual(48)
      expect(style.minWidth).toBeGreaterThanOrEqual(48)
      const text = within(target).getByText(label)
      expect(text.props.allowFontScaling).not.toBe(false)
      expect(text.props.numberOfLines).toBeUndefined()
    }
    await fireEvent.press(screen.getByRole('tab', { name: 'Accounts' }))
    expect(router.getPathname()).toBe('/accounts')
    expect(screen.getByRole('tab', { name: 'Accounts' }).props.accessibilityState).toMatchObject({ selected: true })
    await fireEvent.press(screen.getByRole('tab', { name: 'Budgets' }))
    expect(router.getPathname()).toBe('/budgets')
    expect(screen.getByRole('tab', { name: 'Budgets' }).props.accessibilityState).toMatchObject({ selected: true })
    await fireEvent.press(screen.getByRole('tab', { name: 'Portfolio' }))
    expect(router.getPathname()).toBe('/portfolio')
    expect(screen.getByRole('tab', { name: 'Portfolio' }).props.accessibilityState).toMatchObject({ selected: true })
    await fireEvent.press(screen.getByRole('tab', { name: 'More' }))
    expect(router.getPathname()).toBe('/more')
    expect(screen.getByRole('tab', { name: 'More' }).props.accessibilityState).toMatchObject({ selected: true })
  })

  it('renders one scrollable wide rail with five 48dp targets', async () => {
    await renderShell(768)
    const rail = screen.getByTestId('product-rail')
    expect(screen.queryByTestId('product-bottom-bar')).not.toBeOnTheScreen()
    expect(within(rail).getAllByRole('tab')).toHaveLength(5)
    expect(StyleSheet.flatten(rail.props.contentContainerStyle).flexGrow).toBe(1)
    for (const label of ['Home', 'Accounts', 'Budgets', 'Portfolio', 'More']) {
      const target = within(rail).getByRole('tab', { name: label })
      const style = StyleSheet.flatten(target.props.style)
      expect(style.minHeight).toBeGreaterThanOrEqual(48)
      expect(style.minWidth).toBeGreaterThanOrEqual(48)
      expect(within(target).getByText(label).props.allowFontScaling).not.toBe(false)
    }
  })

  it('keeps the five Portuguese destinations visible and scalable', async () => {
    await renderShell(320, 'pt-PT')
    for (const label of ['Início', 'Contas', 'Orçamentos', 'Portefólio', 'Mais']) {
      const target = screen.getByRole('tab', { name: label })
      const text = within(target).getByText(label)
      expect(text.props.allowFontScaling).not.toBe(false)
      expect(text.props.numberOfLines).toBeUndefined()
    }
  })

  it('pushes account detail outside the tab bar without creating a third destination', async () => {
    const rendered = await renderShell(390)
    await act(() => router.navigate('/accounts/42'))
    expect(rendered.getPathname()).toBe('/accounts/42')
    expect(screen.getByText('account detail screen')).toBeOnTheScreen()
    expect(screen.queryByTestId('product-bottom-bar')).not.toBeOnTheScreen()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('pushes portfolio detail outside the adaptive navigation', async () => {
    const rendered = await renderShell(320)
    await act(() => router.navigate('/portfolio/42'))
    expect(rendered.getPathname()).toBe('/portfolio/42')
    expect(screen.getByText('portfolio detail screen')).toBeOnTheScreen()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it.each([
    ['/settings/profile', 'profile screen'],
    ['/settings/subscription-status', 'subscription screen'],
  ])('keeps pushed self route %s outside tab navigation', async (path, text) => {
    await renderShell(390)
    await act(() => router.navigate(path as never))
    expect(screen.getByText(text)).toBeOnTheScreen()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })
})
