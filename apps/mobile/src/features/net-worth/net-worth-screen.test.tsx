import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { NetWorthScreen, type BudgetHealthState, type InsightState, type NetWorthData } from './net-worth-screen'

const data: NetWorthData = {
  primaryCurrency: 'EUR',
  total: 1200,
  accounts: 1500,
  portfolio: 200,
  liabilities: -500,
  completeness: 'unknown',
  unsupportedLoanCount: 0,
  unsupportedPortfolioCount: 0,
  sources: [
    { id: 'bank', label: 'Main account', value: 1500, currency: 'EUR', kind: 'account' },
    { id: 'card', label: 'Credit card', value: -500, currency: 'EUR', kind: 'loan' },
  ],
}

async function renderScreen(
  state: React.ComponentProps<typeof NetWorthScreen>['state'],
  budgetHealth: BudgetHealthState = { status: 'hidden' },
  insight: InsightState = { status: 'hidden' },
) {
  const i18n = await initMobileI18n('en')
  const refresh = jest.fn()
  const logout = jest.fn()
  const viewHistory = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <NetWorthScreen state={state} budgetHealth={budgetHealth} insight={insight} onRefresh={refresh} onLogout={logout} onViewHistory={viewHistory} />
    </I18nextProvider>,
  )
  return { view, refresh, logout, viewHistory }
}

describe('NetWorthScreen', () => {
  it('shows the server values and ordered source rows without recomputing the total', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.getByRole('header', { name: 'At a glance' })).toBeOnTheScreen()
    // The provenance line restated the currency symbol already on every figure.
    expect(view.queryByText(/based on balances currently available/i)).toBeNull()
    expect(view.getByTestId('net-worth-total').props.children).toContain('1,200')
    expect(view.getByLabelText(/Current estimate,.*1,200.*EUR/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Accounts,.*1,500.*EUR/)).toBeOnTheScreen()
    expect(view.getByText('Main account')).toBeOnTheScreen()
    expect(view.getByText('Credit card')).toBeOnTheScreen()
    expect(view.getByLabelText(/Credit card,.*-.*500.*EUR/)).toBeOnTheScreen()
    // `unknown` is the view model's else-branch — it fires on every ordinary
    // load, so hedging the figure there said nothing and cost confidence.
    expect(view.queryByText(/completeness of this estimate/i)).toBeNull()
  })

  it('formats credit source values exactly as returned without sign normalization', async () => {
    const positiveCredit: NetWorthData = {
      ...data,
      sources: [{ id: 'loan-positive', label: 'Server loan value', value: 125, currency: 'EUR', kind: 'loan' }],
    }
    const { view } = await renderScreen({ status: 'loaded', data: positiveCredit })

    expect(view.getByLabelText(/Server loan value,.*125.*EUR.*Liability/)).toBeOnTheScreen()
    expect(view.queryByLabelText(/Server loan value,.*-.*125.*EUR/)).not.toBeOnTheScreen()
  })

  it('renders zero as a real financial value', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { ...data, total: 0 } })
    expect(view.getByTestId('net-worth-total').props.children).toContain('0')
  })

  it('uses currency-native fraction digits for EUR and JPY in text and accessibility labels', async () => {
    const eur = await renderScreen({ status: 'loaded', data })
    expect(eur.view.getByTestId('net-worth-total').props.children).toMatch(/1,200\.00/)
    expect(eur.view.getByLabelText(/Current estimate,.*1,200\.00.*EUR/)).toBeOnTheScreen()

    const jpyData: NetWorthData = {
      ...data,
      primaryCurrency: 'JPY',
      total: 1200,
      accounts: 1500,
      portfolio: 200,
      liabilities: -500,
      sources: [{ id: 'yen', label: 'Yen account', value: 1500, currency: 'JPY', kind: 'account' }],
    }
    const jpy = await renderScreen({ status: 'loaded', data: jpyData })
    expect(jpy.view.getByTestId('net-worth-total').props.children).toMatch(/1,200(?!\.00)/)
    expect(jpy.view.getByLabelText(/Current estimate,.*1,200(?!\.00).*JPY/)).toBeOnTheScreen()
    expect(jpy.view.getByLabelText(/Yen account,.*1,500(?!\.00).*JPY/)).toBeOnTheScreen()
  })

  it('explains an empty server source list without inventing financial data', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { ...data, sources: [] } })

    expect(view.getByText('No sources are currently available')).toBeOnTheScreen()
    expect(view.queryByText('Main account')).not.toBeOnTheScreen()
  })

  it('shows honest partial completeness and plural unsupported warnings', async () => {
    const { view } = await renderScreen({
      status: 'loaded',
      data: { ...data, completeness: 'partial', unsupportedLoanCount: 2, unsupportedPortfolioCount: 1 },
    })
    expect(view.getByText('Partial — some sources are unavailable')).toBeOnTheScreen()
    expect(view.getByText('2 loan balances are not included')).toBeOnTheScreen()
    expect(view.getByText('1 portfolio is not included')).toBeOnTheScreen()
  })

  it('keeps prior data with an explicit stale banner after refresh failure', async () => {
    const { view } = await renderScreen({ status: 'refresh-error', data })
    expect(view.getByRole('alert', { name: 'Could not refresh. Showing previously loaded values' })).toBeOnTheScreen()
    expect(view.getByTestId('net-worth-total')).toBeOnTheScreen()
  })

  it('hides financial values for an invalid response', async () => {
    const { view } = await renderScreen({ status: 'invalid-response' })
    expect(view.getByText('The financial data received could not be verified')).toBeOnTheScreen()
    expect(view.queryByTestId('net-worth-total')).not.toBeOnTheScreen()
    expect(view.queryByText('Main account')).not.toBeOnTheScreen()
  })

  it('provides restrained loading and specific initial recovery actions', async () => {
    const loading = await renderScreen({ status: 'loading' })
    expect(loading.view.getByRole('progressbar', { name: 'Loading estimated net worth' })).toBeOnTheScreen()
    expect(loading.view.queryByText('Loading estimated net worth')).not.toBeOnTheScreen()

    const failed = await renderScreen({ status: 'error' })
    await fireEvent.press(failed.view.getByRole('button', { name: 'Retry' }))
    await fireEvent.press(failed.view.getByRole('button', { name: 'Sign out' }))
    expect(failed.refresh).toHaveBeenCalledTimes(1)
    expect(failed.logout).toHaveBeenCalledTimes(1)
  })

  it('keeps sign-out out of the primary dashboard, matching the web account menu', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.queryByRole('button', { name: 'Sign out' })).not.toBeOnTheScreen()
  })

  it('offers a net worth trend entry from the loaded state', async () => {
    const { view, viewHistory } = await renderScreen({ status: 'loaded', data })
    await fireEvent.press(view.getByRole('button', { name: 'View net worth trend' }))
    expect(viewHistory).toHaveBeenCalledTimes(1)
  })

  it('keeps the primary action scalable and at least 48dp', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    for (const name of ['View net worth trend']) {
      const action = view.getByRole('button', { name })
      expect(StyleSheet.flatten(action.props.style).minHeight).toBeGreaterThanOrEqual(48)
      expect(within(action).getByText(name).props.allowFontScaling).not.toBe(false)
    }
  })

  it('uses pull-to-refresh instead of a persistent refresh button', async () => {
    const { view } = await renderScreen({ status: 'loaded', data, refreshing: true })
    expect(view.queryByRole('button', { name: 'Refresh' })).not.toBeOnTheScreen()
  })

  describe('budget health card', () => {
    it('shows nothing when there is no current-period budget', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'hidden' })
      expect(view.queryByText('Budget health')).not.toBeOnTheScreen()
    })

    it('shows a loading placeholder independently of the net worth section', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'loading' })
      expect(view.getByRole('progressbar', { name: 'Loading budget health' })).toBeOnTheScreen()
    })

    it('shows a scoped error without blocking the rest of the dashboard', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'error' })
      expect(view.getByText('Could not load budget health')).toBeOnTheScreen()
      expect(view.getByRole('header', { name: 'At a glance' })).toBeOnTheScreen()
    })

    it('shows planned/spent/remaining and flags an overspent budget', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, {
        status: 'loaded',
        data: { planned: 500, spent: 550, remaining: -50, currencyCode: 'EUR', meterPercentage: 100, overspent: true },
      })
      expect(view.getByRole('header', { name: 'Budget health' })).toBeOnTheScreen()
      expect(view.getByText('€550.00 of €500.00 planned')).toBeOnTheScreen()
      expect(view.getByText('Over budget')).toBeOnTheScreen()
    })

    it('shows an on-track budget without the overspent flag', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, {
        status: 'loaded',
        data: { planned: 1000, spent: 400, remaining: 600, currencyCode: 'EUR', meterPercentage: 40, overspent: false },
      })
      expect(view.getByText('€400.00 of €1,000.00 planned')).toBeOnTheScreen()
      expect(view.queryByText('Over budget')).not.toBeOnTheScreen()
    })
  })

  describe('insights card', () => {
    it('shows nothing when there is no spending this period', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'hidden' }, { status: 'hidden' })
      expect(view.queryByText('Insights')).not.toBeOnTheScreen()
    })

    it('shows a loading placeholder independently of the rest of the dashboard', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'hidden' }, { status: 'loading' })
      expect(view.getByRole('progressbar', { name: 'Loading insights' })).toBeOnTheScreen()
    })

    it('shows a scoped error without blocking the rest of the dashboard', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'hidden' }, { status: 'error' })
      expect(view.getByText('Could not load insights')).toBeOnTheScreen()
      expect(view.getByRole('header', { name: 'At a glance' })).toBeOnTheScreen()
    })

    it('shows the top spending category and amount for the period', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'hidden' }, {
        status: 'loaded',
        data: { name: 'Groceries', amount: 420, currency: 'EUR' },
      })
      expect(view.getByRole('header', { name: 'Insights' })).toBeOnTheScreen()
      expect(view.getByText('Groceries — €420.00 this month')).toBeOnTheScreen()
    })

    it('falls back to the account primary currency when the category currency is unavailable', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'hidden' }, {
        status: 'loaded',
        data: { name: 'Mixed currency', amount: 100, currency: null },
      })
      expect(view.getByText('Mixed currency — €100.00 this month')).toBeOnTheScreen()
    })
  })

  describe('combined card states', () => {
    it('keeps a stale net worth banner visible alongside an independently failed budget card and a still-loading insights card', async () => {
      const { view } = await renderScreen({ status: 'refresh-error', data }, { status: 'error' }, { status: 'loading' })

      expect(view.getByRole('alert', { name: 'Could not refresh. Showing previously loaded values' })).toBeOnTheScreen()
      expect(view.getByTestId('net-worth-total')).toBeOnTheScreen()
      expect(view.getByText('Could not load budget health')).toBeOnTheScreen()
      expect(view.getByRole('progressbar', { name: 'Loading insights' })).toBeOnTheScreen()
    })

    it('shows a loaded budget card and a failed insights card together without either affecting the other', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, {
        status: 'loaded',
        data: { planned: 500, spent: 550, remaining: -50, currencyCode: 'EUR', meterPercentage: 100, overspent: true },
      }, { status: 'error' })

      expect(view.getByText('Over budget')).toBeOnTheScreen()
      expect(view.getByText('Could not load insights')).toBeOnTheScreen()
      expect(view.getByRole('header', { name: 'At a glance' })).toBeOnTheScreen()
    })

    it('shows neither card when both are hidden, leaving the net worth section as the only content', async () => {
      const { view } = await renderScreen({ status: 'loaded', data }, { status: 'hidden' }, { status: 'hidden' })

      expect(view.queryByText('Budget health')).not.toBeOnTheScreen()
      expect(view.queryByText('Insights')).not.toBeOnTheScreen()
      expect(view.getByRole('header', { name: 'At a glance' })).toBeOnTheScreen()
    })

    it('suppresses both cards while the primary net worth data is still loading', async () => {
      const { view } = await renderScreen({ status: 'loading' }, { status: 'loaded', data: { planned: 100, spent: 10, remaining: 90, currencyCode: 'EUR', meterPercentage: 10, overspent: false } }, {
        status: 'loaded',
        data: { name: 'Groceries', amount: 20, currency: 'EUR' },
      })

      expect(view.getByRole('progressbar', { name: 'Loading estimated net worth' })).toBeOnTheScreen()
      expect(view.queryByText('Budget health')).not.toBeOnTheScreen()
      expect(view.queryByText('Insights')).not.toBeOnTheScreen()
    })

    it('suppresses both cards behind the primary error panel when net worth itself fails to load', async () => {
      const { view } = await renderScreen({ status: 'error' }, { status: 'loaded', data: { planned: 100, spent: 10, remaining: 90, currencyCode: 'EUR', meterPercentage: 10, overspent: false } }, {
        status: 'loaded',
        data: { name: 'Groceries', amount: 20, currency: 'EUR' },
      })

      expect(view.getByText('Could not load estimated net worth')).toBeOnTheScreen()
      expect(view.queryByText('Budget health')).not.toBeOnTheScreen()
      expect(view.queryByText('Insights')).not.toBeOnTheScreen()
    })
  })
})
