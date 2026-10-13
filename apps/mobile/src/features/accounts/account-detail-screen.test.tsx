import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'

import { AccountDetailScreen, type AccountDetailData } from './account-detail-screen'

const openBanking: AccountDetailData = {
  accountId: 42,
  accountName: 'Everyday',
  institutionDisplayName: 'Wonder Bank',
  isOwnedByViewer: true,
  isPrivate: false,
  originalBalance: 100,
  convertedBalance: 90.25,
  originalCurrencyCode: 'USD',
  primaryCurrencyCode: 'EUR',
  refreshedAt: '2026-07-17T10:00:00.000Z',
  source: 'open_banking',
}

async function renderScreen(state: React.ComponentProps<typeof AccountDetailScreen>['state']) {
  const i18n = await initMobileI18n('en')
  const back = jest.fn()
  const retry = jest.fn()
  const logout = jest.fn()
  const edit = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <AccountDetailScreen
        state={state}
        recentTransactions={{ status: 'loaded', rows: [], stale: false }}
        onBack={back}
        onRetry={retry}
        onRetryRecent={jest.fn()}
        onLogout={logout}
        onViewTransactions={jest.fn()}
        onEdit={edit}
      />
    </I18nextProvider>,
  )
  return { view, back, retry, logout, edit }
}

describe('AccountDetailScreen', () => {
  it('shows only the bounded read-only detail and an accessible Back action', async () => {
    const { view, back, edit } = await renderScreen({ status: 'loaded', data: openBanking })
    const original = formatCurrency(100, { locale: 'en', currency: 'USD' })
    const converted = formatCurrency(90.25, { locale: 'en', currency: 'EUR' })
    expect(view.getByRole('header', { name: 'Everyday' })).toBeOnTheScreen()
    // Institution and source are one descriptor line — "Wonder Bank · Open
    // Banking" — rather than two stacked muted lines under the title.
    expect(view.getByText('Wonder Bank · Open Banking')).toBeOnTheScreen()
    expect(view.getByLabelText(`Original balance, ${original}, USD`)).toBeOnTheScreen()
    expect(view.getByLabelText(`Converted balance, ${converted}, EUR`)).toBeOnTheScreen()
    expect(view.getByText(/^Last updated /)).toBeOnTheScreen()
    const button = view.getByRole('button', { name: 'Back' })
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44)
    await fireEvent.press(button)
    expect(back).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
    expect(view.getByText('View account transactions')).toBeOnTheScreen()
    expect(view.queryByText(/chart|delete|import|add|refresh bank/i)).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Edit account' }))
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('preserves zero and null, avoids same-currency duplication, and omits freshness for manual accounts', async () => {
    const manual: AccountDetailData = {
      ...openBanking,
      accountName: null,
      institutionDisplayName: null,
      originalBalance: 0,
      convertedBalance: 0,
      originalCurrencyCode: 'EUR',
      source: 'manual',
      refreshedAt: null,
    }
    const { view } = await renderScreen({ status: 'loaded', data: manual })
    expect(view.getByRole('header', { name: 'Unnamed account' })).toBeOnTheScreen()
    expect(view.getByLabelText(/Original balance,.*0\.00.*EUR/)).toBeOnTheScreen()
    expect(view.queryByText('Converted balance')).not.toBeOnTheScreen()
    expect(view.queryByText(/updated|update time/i)).not.toBeOnTheScreen()

    const convertedZero = await renderScreen({
      status: 'loaded',
      data: { ...openBanking, convertedBalance: 0 },
    })
    expect(convertedZero.view.getByLabelText(/Converted balance,.*0\.00.*EUR/)).toBeOnTheScreen()

    const unavailable = await renderScreen({
      status: 'loaded',
      data: { ...openBanking, originalBalance: null, convertedBalance: null, refreshedAt: null },
    })
    expect(unavailable.view.getByText('Balance unavailable')).toBeOnTheScreen()
    expect(unavailable.view.getByText('Converted balance unavailable')).toBeOnTheScreen()
    expect(unavailable.view.getByText('Update time unavailable')).toBeOnTheScreen()
  })

  it('labels account metrics from the selected start through server-now', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { ...openBanking, metricsFromDate: '2026-07-01T00:00:00.000Z', metrics: [{ accountId: 42, accountName: 'Everyday', currency: 'USD', inflow: 100, outflow: 40, transactionCount: 2 }] } })
    expect(view.getByText('Account metrics')).toBeOnTheScreen()
    expect(view.getByText(/through the server's current time/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Inflow,.*100\.00.*USD/)).toBeOnTheScreen()
    expect(view.queryByText(/end date/i)).not.toBeOnTheScreen()
  })

  it('handles loading, not found, stale, invalid, and access transition states', async () => {
    const loading = await renderScreen({ status: 'loading' })
    expect(loading.view.getByRole('progressbar', { name: 'Loading account' })).toBeOnTheScreen()

    const stale = await renderScreen({ status: 'refresh-error', data: openBanking })
    expect(stale.view.getByRole('alert', { name: 'Could not refresh. Showing previously loaded account details' })).toBeOnTheScreen()
    expect(stale.view.getByText('Everyday')).toBeOnTheScreen()

    for (const status of ['not-found', 'invalid-id', 'invalid-response', 'error'] as const) {
      const failed = await renderScreen({ status })
      expect(failed.view.queryByText('Everyday')).not.toBeOnTheScreen()
      expect(failed.view.getByRole('button', { name: 'Back' })).toBeOnTheScreen()
    }

    const access = await renderScreen({ status: 'access-transition' })
    expect(access.view.toJSON()).toBeNull()
  })

  it('keeps action text scalable', async () => {
    const { view } = await renderScreen({ status: 'error' })
    for (const name of ['Back', 'Retry', 'Sign out']) {
      expect(within(view.getByRole('button', { name })).getByText(name).props.allowFontScaling).not.toBe(false)
    }
  })
})
