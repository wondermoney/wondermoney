import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'

import { AccountDetailScreen, type AccountDetailData } from './account-detail-screen'
import { touchHeight } from '@/test/touch-target'

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
  csvImportFormat: null,
}

async function renderScreen(state: React.ComponentProps<typeof AccountDetailScreen>['state'], extra: Partial<React.ComponentProps<typeof AccountDetailScreen>> = {}) {
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
        {...extra}
      />
    </I18nextProvider>,
  )
  return { view, back, retry, logout, edit }
}

jest.mock('victory-native', () => ({
  CartesianChart: (props: { children: (args: { points: Record<string, unknown>; chartBounds: { bottom: number } }) => React.ReactNode }) =>
    props.children({ points: { balance: [] }, chartBounds: { bottom: 0 } }),
  Area: () => null,
  Line: () => null,
}))

describe('AccountDetailScreen', () => {
  it('matches web: back link, name and institution, the balance figure, Edit and Back', async () => {
    const { view, back, edit } = await renderScreen({ status: 'loaded', data: openBanking })
    const converted = formatCurrency(90.25, { locale: 'en', currency: 'EUR' })
    expect(view.getByRole('header', { name: 'Everyday' })).toBeOnTheScreen()
    expect(view.getByText('Wonder Bank')).toBeOnTheScreen()
    // A USD account read in EUR leads with the EUR figure, the USD one beside it.
    expect(view.getByLabelText(`Account balance, ${converted}`)).toBeOnTheScreen()
    expect(view.getByText(/^Balances updated /)).toBeOnTheScreen()
    const button = view.getByRole('button', { name: 'Back' })
    expect(touchHeight(button)).toBeGreaterThanOrEqual(44)
    await fireEvent.press(button)
    expect(back).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'Last transactions' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'View all' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Edit account' }))
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('adds a transaction from the floating "+" and keeps edit and import behind the overflow menu', async () => {
    const onCreateTransaction = jest.fn()
    const onImportTransactions = jest.fn()
    const { view, edit } = await renderScreen({ status: 'loaded', data: openBanking }, { onCreateTransaction, onImportTransactions })
    const add = view.getByTestId('account-add-transaction')
    expect(add.props.accessibilityLabel).toBe('Add transaction')
    expect(touchHeight(add)).toBeGreaterThanOrEqual(44)
    await fireEvent.press(add)
    expect(onCreateTransaction).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('button', { name: 'Import transactions' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'More actions' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Import transactions' }))
    expect(onImportTransactions).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'More actions' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Edit account' }))
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('recalculates balances from the overflow menu after a confirmation', async () => {
    const onRecalculate = jest.fn()
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const { view } = await renderScreen({ status: 'loaded', data: openBanking }, { onRecalculate, recalculation: { phase: 'idle' } })

    await fireEvent.press(view.getByRole('button', { name: 'More actions' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Recalculate balances' }))
    expect(onRecalculate).not.toHaveBeenCalled()
    const buttons = alert.mock.calls[0]?.[2] ?? []
    buttons.find((button) => button.text === 'Recalculate')?.onPress?.()
    expect(onRecalculate).toHaveBeenCalledTimes(1)
    alert.mockRestore()
  })

  it('shows a recalculation running, then what it corrected', async () => {
    const running = await renderScreen({ status: 'loaded', data: openBanking }, { onRecalculate: jest.fn(), recalculation: { phase: 'running' } })
    expect(running.view.getByRole('alert', { name: 'Recalculating balances…' })).toBeOnTheScreen()

    const onDismissRecalculation = jest.fn()
    const done = await renderScreen({ status: 'loaded', data: openBanking }, {
      onRecalculate: jest.fn(),
      onDismissRecalculation,
      recalculation: { phase: 'done', result: { balanceAfter: 140, balanceBefore: 500, currency: 'USD', rowsChanged: 2 } },
    })
    const notice = done.view.getByTestId('account-recalculation')
    expect(within(notice).getByText('Balances recalculated: 2 transactions corrected')).toBeOnTheScreen()
    const before = formatCurrency(500, { locale: 'en', currency: 'USD' })
    const after = formatCurrency(140, { locale: 'en', currency: 'USD' })
    expect(within(notice).getByText(`Balance: ${before} → ${after}`)).toBeOnTheScreen()
    await fireEvent.press(within(notice).getByRole('button', { name: 'Dismiss' }))
    expect(onDismissRecalculation).toHaveBeenCalledTimes(1)

    const tooSoon = await renderScreen({ status: 'loaded', data: openBanking }, { onRecalculate: jest.fn(), recalculation: { phase: 'error', reason: 'too-soon' } })
    expect(tooSoon.view.getByRole('alert', { name: 'This account was recalculated less than a minute ago. Try again shortly.' })).toBeOnTheScreen()
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
    expect(view.getByLabelText(/Account balance,.*0\.00/)).toBeOnTheScreen()
    expect(view.queryByText(/updated/i)).not.toBeOnTheScreen()

    const unavailable = await renderScreen({
      status: 'loaded',
      data: { ...openBanking, originalBalance: null, convertedBalance: null, refreshedAt: null },
    })
    expect(unavailable.view.getAllByText('Balance unavailable').length).toBeGreaterThan(0)
  })

  it('shows inflow, outflow and savings rate with last period beside each', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { ...openBanking, metrics: { status: 'loaded', summary: { inflowCurrent: 100, inflowPast: 50, outflowCurrent: 40, outflowPast: 20, inflowPct: 1, outflowPct: 1, netSavings: 60, netSavingsPast: 30, savingsRate: 0.6 } } } })
    for (const label of ['Inflow', 'Outflow', 'Savings rate']) expect(view.getByText(label)).toBeOnTheScreen()
    expect(view.getAllByText('vs last period')).toHaveLength(3)
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
    for (const [name, text] of [['Back', 'Accounts'], ['Retry', 'Retry'], ['Sign out', 'Sign out']] as const) {
      expect(within(view.getByRole('button', { name })).getByText(text).props.allowFontScaling).not.toBe(false)
    }
  })
})
