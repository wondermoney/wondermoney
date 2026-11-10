import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import type { PreferenceStorage } from '@/features/preferences/preference-storage'
import { initMobileI18n } from '@/lib/i18n'
import { memoryPreferenceStorage, PrivacyModeProvider, renderedText } from '@/test/privacy-mode'
import { inTimeZone } from '@/test/time-zone'

import type { BudgetMonthRow } from './home-sections'
import { NetWorthScreen, type HomeSections, type NetWorthData, type NetWorthScreenProps } from './net-worth-screen'

// The Skia canvas needs a native backend jest doesn't have.
jest.mock('victory-native', () => ({ CartesianChart: () => null, Area: () => null, Line: () => null }))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined) }))

const today = new Date(2026, 10, 5)

const data: NetWorthData = {
  primaryCurrency: 'EUR',
  total: 1200,
  completeness: 'unknown',
  unsupportedLoanCount: 0,
  unsupportedPortfolioCount: 0,
  rows: [
    { type: 'accounts', name: 'Main account', balance: 1500 },
    { type: 'accounts', name: 'Credit card', balance: -500 },
    { type: 'portfolios', name: 'Brokerage', balance: 325 },
    { type: 'loans', name: 'Car loan', balance: 125 },
  ],
}

const sections: HomeSections = {
  history: { status: 'loaded', data: [
    { date: '2025-12-31', value: 900 },
    { date: '2026-10-31', value: 1300 },
    { date: '2026-11-05', value: 1200 },
  ] },
  freshness: new Date(Date.now() - 26 * 3_600_000),
  setup: null,
  month: { status: 'loaded', data: [] },
  cashflow: { status: 'loaded', data: { zero: 0, bars: [] } },
  loans: { status: 'loaded', data: { upcoming: [], hasLoans: false } },
  latest: { status: 'loaded', data: { transactions: [], unreviewedCount: 0 } },
  insight: { status: 'hidden' },
}

async function renderScreen(overrides: Partial<NetWorthScreenProps> = {}, sectionOverrides: Partial<HomeSections> = {}, privacy?: PreferenceStorage) {
  const i18n = await initMobileI18n('en')
  const props: NetWorthScreenProps = {
    state: { status: 'loaded', data },
    sections: { ...sections, ...sectionOverrides },
    today,
    onRefresh: jest.fn(),
    onLogout: jest.fn(),
    onViewHistory: jest.fn(),
    onNavigate: jest.fn(),
    onRetryHistory: jest.fn(),
    onRetryBudgets: jest.fn(),
    onRetryCashflow: jest.fn(),
    onRetryLoans: jest.fn(),
    onRetryLatest: jest.fn(),
    onDismissSetup: jest.fn(),
    ...overrides,
  }
  const screen = <NetWorthScreen {...props} />
  const view = await render(<I18nextProvider i18n={i18n}>{privacy ? <PrivacyModeProvider storage={privacy}>{screen}</PrivacyModeProvider> : screen}</I18nextProvider>)
  return { view, props }
}

describe('NetWorthScreen (Home)', () => {
  it('leads with net worth, its freshness, the changes since last month and over the history, and own/owe', async () => {
    const { view } = await renderScreen()
    expect(view.getByRole('header', { name: 'Net worth' })).toBeOnTheScreen()
    expect(view.getByText('Balances updated 1 day ago')).toBeOnTheScreen()
    expect(view.getByLabelText(/^Net worth, €1,200\.00, EUR/)).toBeOnTheScreen()
    expect(view.getByTestId('net-worth-total')).toBeOnTheScreen()
    // 1200 − 1300 at the end of October; 1200 − 900 since December 2025.
    expect(view.getByText('since the end of October')).toBeOnTheScreen()
    expect(view.getByText('since the end of December 2025')).toBeOnTheScreen()
    expect(view.getByLabelText('-€100.00')).toBeOnTheScreen()
    expect(view.getByLabelText('+€300.00')).toBeOnTheScreen()
    // Owned: 1500 + 325; owed: the negative account and the loan, as positives.
    expect(view.getByLabelText('You own, €1,825.00')).toBeOnTheScreen()
    expect(view.getByLabelText('You owe, €625.00')).toBeOnTheScreen()
    expect(view.getByTestId('net-worth-chart')).toBeOnTheScreen()
  })

  it('titles the page, and switches the chart between the ranges the history covers', async () => {
    const months = Array.from({ length: 13 }, (_, index) => {
      const end = new Date(Date.UTC(2025, 10 + index, 0))
      return { date: end.toISOString().slice(0, 10), value: 1000 + index * 10 }
    })
    const { view } = await renderScreen({}, { history: { status: 'loaded', data: months } })
    expect(view.getByRole('header', { name: 'Home' })).toBeOnTheScreen()
    expect(view.getByLabelText(/to October 2026$/)).toBeOnTheScreen()
    expect(view.getByLabelText(/^Net worth at the close of each month, October 2025/)).toBeOnTheScreen()
    expect(view.getByRole('tab', { name: '1Y' })).toBeSelected()
    await fireEvent.press(view.getByRole('tab', { name: '3M' }))
    expect(view.getByLabelText('Net worth at the close of each month, July 2026 to October 2026')).toBeOnTheScreen()
  })

  it("marks a balance-sheet account with its institution's logo, matched by the row's id", async () => {
    const { view } = await renderScreen(
      { state: { status: 'loaded', data: { ...data, rows: [{ type: 'accounts', id: 41, name: 'Main account', balance: 1500 }] } } },
      { accountMarks: new Map([[41, { image: 'https://cdn.example/bank.png', glyph: 'landmark' as const }]]) },
    )
    expect(view.getByTestId('balance-sheet-mark-image', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('itemises the balance sheet with negative balances on the owed side', async () => {
    const { view } = await renderScreen()
    expect(view.getByRole('header', { name: 'Balance sheet' })).toBeOnTheScreen()
    expect(view.getByLabelText(/^Main account, €1,500\.00, EUR$/)).toBeOnTheScreen()
    expect(view.getByLabelText(/^Credit card, €500\.00, EUR, Liability$/)).toBeOnTheScreen()
    expect(view.getByLabelText(/^Car loan, €125\.00, EUR, Liability$/)).toBeOnTheScreen()
  })

  it('keeps the month-by-month trend one tap away', async () => {
    const { view, props } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'View net worth trend' }))
    expect(props.onViewHistory).toHaveBeenCalled()
  })

  it('says so beside the figure when sources are missing', async () => {
    const { view } = await renderScreen({ state: { status: 'loaded', data: { ...data, completeness: 'partial', unsupportedLoanCount: 2, unsupportedPortfolioCount: 1 } } })
    expect(view.getByText('Partial — some sources are unavailable')).toBeOnTheScreen()
    expect(view.getByText('2 loan balances are not included')).toBeOnTheScreen()
    expect(view.getByText('1 portfolio is not included')).toBeOnTheScreen()
  })

  it('keeps previously loaded values on a refresh failure, with a retry', async () => {
    const { view, props } = await renderScreen({ state: { status: 'refresh-error', data } })
    expect(view.getByText('Could not refresh. Showing previously loaded values')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('shows a loading hero, and an error hero that retries without hiding the other sections', async () => {
    const loading = await renderScreen({ state: { status: 'loading' } })
    expect(loading.view.getByRole('progressbar', { name: 'Loading estimated net worth' })).toBeOnTheScreen()

    const failed = await renderScreen({ state: { status: 'invalid-response' } })
    expect(failed.view.getByText('The financial data received could not be verified')).toBeOnTheScreen()
    await fireEvent.press(failed.view.getByRole('button', { name: 'Try again' }))
    expect(failed.props.onRefresh).toHaveBeenCalled()
    await fireEvent.press(failed.view.getByRole('button', { name: 'Sign out' }))
    expect(failed.props.onLogout).toHaveBeenCalled()
    expect(failed.view.getByRole('header', { name: 'This month' })).toBeOnTheScreen()
  })

  it('offers to add an account when there is nothing to sum', async () => {
    const { view, props } = await renderScreen({ state: { status: 'loaded', data: { ...data, total: 0, rows: [] } } })
    expect(view.getByText('No accounts yet')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Add an account' }))
    expect(props.onNavigate).toHaveBeenCalledWith('/accounts')
  })

  it('says the history failed in the chart slot only, with a retry', async () => {
    const { view, props } = await renderScreen({}, { history: { status: 'error' } })
    expect(view.getByText('The change over time didn’t load.')).toBeOnTheScreen()
    expect(view.getByLabelText(/^Net worth, €1,200\.00, EUR/)).toBeOnTheScreen()
    await fireEvent.press(view.getAllByRole('button', { name: 'Try again' })[0])
    expect(props.onRetryHistory).toHaveBeenCalled()
  })

  it('shows each budget’s month: what is left, spent of planned and categories over plan', async () => {
    const rows: BudgetMonthRow[] = [
      { id: 7, name: 'Household', href: '/budgets/7/2026/11', onRetry: jest.fn(), state: { status: 'loaded', data: { currency: 'EUR', summary: { planned: 1000, spent: 400, left: 600, isOverspent: false, overPlanCount: 2 } } } },
      { id: 8, name: 'Holidays', href: '/budgets/8/2026/11', onRetry: jest.fn(), state: { status: 'error' } },
    ]
    const { view, props } = await renderScreen({}, { month: { status: 'loaded', data: rows } })
    expect(view.getByText('25 days of November to go')).toBeOnTheScreen()
    expect(view.getByText('left to spend')).toBeOnTheScreen()
    expect(view.getByLabelText('Household: €400.00 spent of €1,000.00 planned')).toBeOnTheScreen()
    expect(view.getByText('2 categories over plan')).toBeOnTheScreen()
    expect(view.getByText('This month didn’t load.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('link', { name: 'Household' }))
    expect(props.onNavigate).toHaveBeenCalledWith('/budgets/7/2026/11')
  })

  it('offers to create a budget when there is none', async () => {
    const { view, props } = await renderScreen()
    expect(view.getByText('No budget yet')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create a budget' }))
    expect(props.onNavigate).toHaveBeenCalledWith('/budgets')
  })

  it('lists net cash flow by month, loans due and the latest transactions', async () => {
    const { view } = await renderScreen({}, {
      cashflow: { status: 'loaded', data: { zero: 40, bars: [{ date: '2026-10-01T00:00:00.000Z', amount: -200, width: 40 }, { date: '2026-11-01T00:00:00.000Z', amount: 300, width: 60 }] } },
      loans: { status: 'loaded', data: { hasLoans: true, upcoming: [{
        loanKey: 3, name: 'Mortgage', currency: { code: 'EUR', currencyKey: 1 }, includeInNetWorth: true, nextPaymentDate: '2026-11-20T00:00:00.000Z',
        openingBalanceDate: '2020-01-01', openingPrincipalBalance: 200000, outstandingPrincipal: 150000, paymentFrequency: 'MONTHLY',
        progressBasis: 'OPENING_BALANCE', progressPercentage: 25, rateType: 'FIXED', regularPaymentAmount: 900, remainingTermMonthsEstimated: 200,
        status: 'ACTIVE', type: 'MORTGAGE', annualInterestRateBps: 350, providerName: 'Bank',
      }] } },
      latest: { status: 'loaded', data: { unreviewedCount: 3, transactions: [{
        transactionKey: 1, transactionDate: '2026-11-03T10:00:00.000Z', accountKey: { accountKey: 1, accountName: 'Checking', currencyKey: { code: 'EUR' } },
        description: 'Coffee shop', appuserSettlementAmount: -4.5, appuserCurrencyKey: { code: 'EUR' }, reviewed: false, appuserTransactionCategories: [], recurringSeries: null,
      }] } },
    })
    expect(view.getByRole('header', { name: 'Net cash flow by month' })).toBeOnTheScreen()
    expect(view.getByText('Money in less money out across your accounts.')).toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'Next loan payments' })).toBeOnTheScreen()
    expect(view.getByRole('link', { name: 'Mortgage' })).toBeOnTheScreen()
    expect(view.getByText(/left at 3\.50%, Bank/)).toBeOnTheScreen()
    expect(view.getByText('Coffee shop')).toBeOnTheScreen()
    expect(view.getByText('Uncategorised')).toBeOnTheScreen()
    expect(view.getByText('Needs review')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: '3 need review' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'All transactions' })).toBeOnTheScreen()
  })

  describe.each(['America/New_York', 'Asia/Tokyo'])('for a viewer in %s', (zone) => {
    inTimeZone(zone)

    it('dates a date-only bank booking in the latest transactions on its own date', async () => {
      const { view } = await renderScreen({}, {
        latest: { status: 'loaded', data: { unreviewedCount: 0, transactions: [{
          transactionKey: 1, transactionDate: '2026-08-01T00:00:00.000Z', accountKey: { accountKey: 1, accountName: 'Checking', currencyKey: { code: 'EUR' } },
          description: 'Coffee shop', appuserSettlementAmount: -4.5, appuserCurrencyKey: { code: 'EUR' }, reviewed: true, appuserTransactionCategories: [], recurringSeries: null,
        }] } },
      })
      expect(view.getByText('Aug 1, Checking')).toBeOnTheScreen()
    })
  })

  it('shows the setup checklist until every step is done, with its steps behind a toggle', async () => {
    const { view, props } = await renderScreen({}, { setup: { account: true, transactions: true, budget: true, portfolio: false } })
    expect(view.getByText('Finish setting up your dashboard')).toBeOnTheScreen()
    expect(view.getByText('3 of 4 steps complete')).toBeOnTheScreen()
    expect(view.getByText('You’re almost there: one more step unlocks a more useful overview.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Show onboarding steps' }))
    await fireEvent.press(view.getByRole('link', { name: 'Track your investments, Incomplete' }))
    expect(props.onNavigate).toHaveBeenCalledWith('/portfolio')
    await fireEvent.press(view.getByRole('button', { name: 'Hide for now' }))
    expect(props.onDismissSetup).toHaveBeenCalled()

    const done = await renderScreen({}, { setup: { account: true, transactions: true, budget: true, portfolio: true } })
    expect(done.view.queryByText('Finish setting up your dashboard')).toBeNull()
  })

  it('fails one section at a time', async () => {
    const { view, props } = await renderScreen({}, { cashflow: { status: 'error' }, month: { status: 'loading' } })
    expect(view.getByText('Error loading data')).toBeOnTheScreen()
    expect(view.getByRole('progressbar', { name: 'This month' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(props.onRetryCashflow).toHaveBeenCalled()
  })

  it('keeps the top spending category last, as web has no equivalent', async () => {
    const { view } = await renderScreen({}, { insight: { status: 'loaded', data: { name: 'Groceries', amount: 420, currency: 'EUR' } } })
    expect(view.getByRole('header', { name: 'Insights' })).toBeOnTheScreen()
    expect(view.getByText('Groceries — €420.00 this month')).toBeOnTheScreen()
  })

  describe('privacy mode', () => {
    /** Any figure with a currency beside it, in either position. */
    const MONEY = /€\s?[\d−-]|\d\s?€/
    const loadedSections: Partial<HomeSections> = {
      cashflow: { status: 'loaded', data: { zero: 0, bars: [{ date: '2026-10-31', amount: -250 }, { date: '2026-11-30', amount: 410 }] } as never },
      insight: { status: 'loaded', data: { name: 'Groceries', amount: 321.45, currency: 'EUR' } } as never,
    }

    it('shows the same sections\' amounts with the mode off (the control for the test below)', async () => {
      const { view } = await renderScreen({}, loadedSections, memoryPreferenceStorage(false))
      const tree = renderedText(view.toJSON())
      for (const figure of ['1,200', '1,825', '321.45', '410']) expect(tree).toContain(figure)
    })

    it('shows no amount anywhere on home, in text or in accessibility labels', async () => {
      const { view } = await renderScreen({}, loadedSections, memoryPreferenceStorage(true))
      expect((await view.findAllByLabelText('Hidden amount')).length).toBeGreaterThan(0)
      const tree = renderedText(view.toJSON())
      expect(tree).not.toMatch(MONEY)
      for (const figure of ['1,200', '1,825', '625', '100.00', '300.00', '321.45', '410', '250']) expect(tree).not.toContain(figure)
      expect(view.getByLabelText(/^Net worth, Hidden amount, EUR/)).toBeOnTheScreen()
      expect(view.getByLabelText('You own, Hidden amount')).toBeOnTheScreen()
    })

    it('toggles from the home header and remembers the choice on the device', async () => {
      const storage = memoryPreferenceStorage(false)
      const { view } = await renderScreen({}, {}, storage)
      expect(await view.findByLabelText('You own, €1,825.00')).toBeOnTheScreen()

      await fireEvent.press(view.getByRole('button', { name: 'Hide amounts' }))
      expect(await view.findByLabelText('You own, Hidden amount')).toBeOnTheScreen()
      expect(renderedText(view.toJSON())).not.toMatch(MONEY)
      expect(storage.saved).toEqual([true])

      await fireEvent.press(view.getByRole('button', { name: 'Show amounts' }))
      expect(await view.findByLabelText('You own, €1,825.00')).toBeOnTheScreen()
      expect(storage.saved).toEqual([true, false])
    })
  })
})
