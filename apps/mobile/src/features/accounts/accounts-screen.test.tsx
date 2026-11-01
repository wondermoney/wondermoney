import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'

import { accountsResponseSchema } from './accounts-contract'
import { AccountsScreen, type AccountsData } from './accounts-screen'
import { mapAccounts } from './accounts-view-model'

const data: AccountsData = {
  accounts: [
    { accountId: 1, accountName: 'Current account', institutionDisplayName: 'Bank One', isOwnedByViewer: true, isPrivate: false, source: 'open_banking', csvImportFormat: null, originalBalance: 0, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', convertedBalance: 0, refreshedAt: '2026-07-17T10:00:00Z' },
    { accountId: 2, accountName: null, institutionDisplayName: null, isOwnedByViewer: true, isPrivate: false, source: 'manual', csvImportFormat: null, originalBalance: null, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', convertedBalance: null, refreshedAt: null },
    { accountId: 3, accountName: 'Yen savings', institutionDisplayName: 'Bank Two', isOwnedByViewer: false, isPrivate: false, source: 'open_banking', csvImportFormat: null, originalBalance: 1200, originalCurrencyCode: 'JPY', primaryCurrencyCode: 'EUR', convertedBalance: 7.2, refreshedAt: 'invalid' },
  ],
}

async function renderScreen(state: React.ComponentProps<typeof AccountsScreen>['state']) {
  const i18n = await initMobileI18n('en')
  const refresh = jest.fn()
  const logout = jest.fn()
  const selectAccount = jest.fn()
  const view = await render(<I18nextProvider i18n={i18n}><AccountsScreen state={state} onRefresh={refresh} onLogout={logout} onSelectAccount={selectAccount} onCreateAccount={jest.fn()} onViewTransactions={jest.fn()} onViewRecurring={jest.fn()} onInsightPeriodChange={jest.fn()} /></I18nextProvider>)
  return { view, refresh, logout, selectAccount }
}

describe('AccountsScreen', () => {
  it('renders accessible insight periods and keeps mixed-currency account metrics separate', async () => {
    const state: React.ComponentProps<typeof AccountsScreen>['state'] = { status: 'loaded', data: { accounts: data.accounts, insights: { period: 'month', metricGroups: [
      { currency: 'EUR', rows: [{ accountId: 1, accountName: 'Euro account', currency: 'EUR', inflow: 100, outflow: 40, transactionCount: 2 }] },
      { currency: 'USD', rows: [{ accountId: 2, accountName: 'Dollar account', currency: 'USD', inflow: 50, outflow: 20, transactionCount: 1 }] },
    ], categories: [{ id: -1, name: 'Uncategorized', amount: 20, currency: null, transactionCount: 1 }], cashflow: [{ date: '2026-07-01T00:00:00.000Z', amount: -10, currency: null }] } } }
    const { view } = await renderScreen(state)
    expect(view.getByRole('header', { name: 'Insights' })).toBeOnTheScreen()
    expect(view.getByRole('tab', { name: 'Current month' }).props.accessibilityState.selected).toBe(true)
    expect(view.getByText('EUR')).toBeOnTheScreen()
    expect(view.getByText('USD')).toBeOnTheScreen()
    expect(view.getAllByText(/Reporting currency unavailable/)).toHaveLength(2)
    expect(view.getByText('Balances')).toBeOnTheScreen()
  })
  it('preserves order and distinguishes zero, null, and converted balances', async () => {
    const { view, selectAccount } = await renderScreen({ status: 'loaded', data })
    const rows = view.getAllByTestId('account-row')
    const updated = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2026-07-17T10:00:00Z'))
    const eurZero = formatCurrency(0, { locale: 'en', currency: 'EUR' })
    const yen = formatCurrency(1200, { locale: 'en', currency: 'JPY' })
    const converted = formatCurrency(7.2, { locale: 'en', currency: 'EUR' })

    expect(rows).toHaveLength(3)
    expect(rows[0].props.accessibilityLabel).toBe(
      `Current account, Bank One, Open Banking, ${eurZero}, EUR, Updated ${updated}`,
    )
    expect(rows[1].props.accessibilityLabel).toBe(
      'Unnamed account, Manual, Balance unavailable',
    )
    expect(rows[2].props.accessibilityLabel).toBe(
      `Yen savings, Bank Two, Open Banking, ${yen}, JPY, Converted balance, ${converted}, EUR`,
    )
    expect(view.getByText('Bank One')).toBeOnTheScreen()
    expect(view.getByText(/^Updated /)).toBeOnTheScreen()
    expect(view.getByText(/Converted balance:.*€7\.20 EUR/)).toBeOnTheScreen()
    expect(view.queryByText(/invalid/i)).not.toBeOnTheScreen()
    expect(rows[0].props.accessibilityRole).toBe('button')
    expect(StyleSheet.flatten(rows[0].props.style).minHeight).toBeGreaterThanOrEqual(48)
    await fireEvent.press(rows[0])
    expect(selectAccount).toHaveBeenCalledWith(1)
  })

  it('renders empty, loading, stale, initial error, and invalid states safely', async () => {
    const empty = await renderScreen({ status: 'loaded', data: { ...data, accounts: [] } })
    expect(empty.view.getByText('No accounts yet')).toBeOnTheScreen()
    expect(empty.view.getByRole('button', { name: 'Add manual account' })).toBeOnTheScreen()

    const loading = await renderScreen({ status: 'loading' })
    expect(loading.view.getByRole('progressbar', { name: 'Loading accounts' })).toBeOnTheScreen()

    const stale = await renderScreen({ status: 'refresh-error', data })
    expect(stale.view.getByRole('alert', { name: 'Could not refresh. Showing previously loaded balances' })).toBeOnTheScreen()
    expect(stale.view.getByText('Current account')).toBeOnTheScreen()

    for (const status of ['error', 'invalid-response'] as const) {
      const failed = await renderScreen({ status })
      expect(failed.view.queryByText('Current account')).not.toBeOnTheScreen()
      await fireEvent.press(failed.view.getByRole('button', { name: 'Retry' }))
      await fireEvent.press(failed.view.getByRole('button', { name: 'Sign out' }))
      expect(failed.refresh).toHaveBeenCalledTimes(1)
      expect(failed.logout).toHaveBeenCalledTimes(1)
    }
  })

  it('renders no remote images, totals, writes, or detail navigation', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
    expect(view.queryByText(/total|connect|import/i)).not.toBeOnTheScreen()
    expect(view.queryAllByRole('link')).toHaveLength(0)
  })

  it('keeps sign-out out of the primary dashboard, matching the web account menu', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.queryByRole('button', { name: 'Sign out' })).not.toBeOnTheScreen()
  })

  it('hides all account chrome during an access transition', async () => {
    const { view } = await renderScreen({ status: 'access-transition' })
    expect(view.toJSON()).toBeNull()
  })

  it('keeps primary actions scalable and at least 48dp', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    for (const name of ['Add manual account']) {
      const action = view.getByRole('button', { name })
      expect(StyleSheet.flatten(action.props.style).minHeight).toBeGreaterThanOrEqual(48)
      expect(within(action).getByText(name).props.allowFontScaling).not.toBe(false)
    }
  })

  it('uses pull-to-refresh instead of a persistent refresh button', async () => {
    const { view } = await renderScreen({ status: 'loaded', data, refreshing: true })
    expect(view.queryByRole('button', { name: 'Refresh' })).not.toBeOnTheScreen()
  })
})

describe('AccountsScreen with values this build does not know', () => {
  it('renders an account whose source is new to this build', async () => {
    const response = accountsResponseSchema.parse({ accounts: [{
      accountFinancialInstitutionKey: null, accountKey: 4, accountName: 'Imported account', accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
      appuserCurrencyBalance: 10, balance: 10, currencyKey: { code: 'EUR' }, isOwnedByViewer: true, isPrivate: false,
      refreshedAt: null, source: 'csv_import', syncState: 'idle',
    }] })
    const { view } = await renderScreen({ status: 'loaded', data: { accounts: mapAccounts(response) } })
    expect(view.getByText('Imported account')).toBeOnTheScreen()
    expect(view.getByText(/Other source/)).toBeOnTheScreen()
  })
})
