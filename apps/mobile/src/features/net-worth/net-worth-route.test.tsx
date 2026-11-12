import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { NetWorthRoute } from './net-worth-route'

jest.mock('victory-native', () => ({ CartesianChart: () => null, Area: () => null, Line: () => null }))

const mockPush = jest.fn()
const idle = () => ({ isLoading: false, data: undefined as unknown, error: null as unknown, isRefreshFailure: false, isRefreshing: false, isAccessTransition: false, refetch: jest.fn() })
const loaded = (data: unknown) => ({ ...idle(), data })

const netWorthData = {
  totalNetWorth: 1200,
  currencyCode: 'EUR',
  assets: { accounts: 1500, portfolios: 0 },
  liabilities: { loans: 0 },
  unsupportedCurrencies: { loans: 0, portfolios: 0 },
  rows: [{ type: 'accounts', name: 'Main account', balance: 1500 }],
}

let mocks: Record<string, ReturnType<typeof idle>> = {}
let mockMonths: ReturnType<typeof idle>[] = []
let mockDismissed = false
const mockDismiss = jest.fn()

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: jest.fn() }) }))
jest.mock('./use-net-worth', () => ({ useNetWorth: () => mocks.netWorth }))
jest.mock('./use-net-worth-history', () => ({ useNetWorthHistory: () => mocks.history }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mocks.accounts }))
jest.mock('@/features/budgets/use-budgets', () => ({ useBudgets: () => mocks.budgets }))
jest.mock('@/features/loans/use-loans', () => ({ useLoans: () => mocks.loans }))
jest.mock('@/features/transactions/use-transactions', () => ({
  useTransactions: () => mocks.latest,
}))
jest.mock('@/features/transactions/use-transaction-review-summary', () => ({
  useTransactionReviewSummary: () => mocks.reviewSummary,
}))
jest.mock('@/features/account-insights/use-top-spending-category', () => ({ useTopSpendingCategory: () => mocks.insight }))
jest.mock('@/features/insights/use-insights', () => ({ useInsights: () => mocks.insights }))
jest.mock('./use-home-data', () => ({
  useHomeBudgetMonths: () => mockMonths,
  useHomeCashflow: () => mocks.cashflow,
  useHomeCashflowComparison: () => mocks.cashflowComparison,
  useHomePortfolios: () => mocks.portfolios,
}))
let mockBankAlertBanner: unknown = null
const mockDismissBankAlert = jest.fn()
jest.mock('@/features/banking/use-bank-alerts', () => ({
  useBankAlertBanner: () => ({ banner: mockBankAlertBanner, dismiss: mockDismissBankAlert, refetch: jest.fn() }),
}))
let mockLinkDismissal = { dismissed: false, loaded: true }
const mockDismissLink = jest.fn()
jest.mock('./use-portfolio-link-suggestion-dismissal', () => ({ usePortfolioLinkSuggestionDismissal: () => ({ ...mockLinkDismissal, dismiss: mockDismissLink }) }))
const mockLinkMutate = jest.fn()
jest.mock('@/features/portfolios/use-portfolio-account-link', () => {
  const actual = jest.requireActual<typeof import('@/features/portfolios/use-portfolio-account-link')>('@/features/portfolios/use-portfolio-account-link')
  return { ...actual, useLinkPortfolioAccount: () => ({ mutateAsync: mockLinkMutate, isPending: false }) }
})
jest.mock('./use-setup-checklist-dismissal', () => ({ useSetupChecklistDismissal: () => ({ dismissed: mockDismissed, dismiss: mockDismiss }) }))
jest.mock('@/features/preferences/use-dashboard-layout', () => ({
  useDashboardLayout: () => ({
    layout: [
      { id: 'net-worth', hidden: false },
      { id: 'insights', hidden: false },
      { id: 'this-month', hidden: false },
      { id: 'balance-sheet', hidden: false },
      { id: 'cashflow', hidden: false },
      { id: 'loans', hidden: false },
      { id: 'latest-transactions', hidden: false },
    ],
    storedLayout: [],
    isLoading: false,
    isLoadError: false,
    isSaving: false,
    saveError: false,
    retryLoad: jest.fn(),
    save: jest.fn(),
  }),
}))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><NetWorthRoute /></I18nextProvider>)
}

const now = new Date()
const budget = (budgetKey: number, name: string, categories: unknown[] = []) => ({
  budgetKey, name, description: null, currencyCode: 'EUR', year: now.getFullYear(), month: now.getMonth() + 1, accounts: [], incomes: [], categories,
})

describe('NetWorthRoute', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockDismissed = false
    mockBankAlertBanner = null
    mockDismissBankAlert.mockClear()
    mockLinkDismissal = { dismissed: false, loaded: true }
    mockDismissLink.mockClear()
    mockLinkMutate.mockReset()
    mockMonths = []
    mocks = {
      netWorth: loaded(netWorthData),
      history: loaded({ currencyCode: 'EUR', granularity: 'monthly', readiness: 'ready', points: [] }),
      accounts: loaded({ accounts: [{ accountKey: 1, refreshedAt: new Date(Date.now() - 26 * 3600_000).toISOString() }] }),
      budgets: loaded({ budgets: [] }),
      loans: loaded({ loans: [] }),
      latest: loaded({ transactions: [] }),
      reviewSummary: loaded({ count: 0, currency: 'EUR', totalAbs: 0 }),
      insight: loaded({ categorySpending: [] }),
      insights: loaded({ insights: [] }),
      cashflow: loaded({ cashflow: [] }),
      cashflowComparison: loaded({ cashflow: [] }),
      portfolios: loaded({ portfolios: [] }),
    }
  })

  it('renders Home with the figure and the oldest balance refresh', async () => {
    const view = await renderRoute()
    expect(view.getByLabelText(/^Net worth, €1,200\.00, EUR/)).toBeOnTheScreen()
    expect(view.getByText('Balances updated 1 day ago')).toBeOnTheScreen()
    expect(view.queryByTestId('home-bank-alert')).toBeNull()
  })

  it('shows the review status from the summary endpoint', async () => {
    mocks.latest = loaded({ transactions: [{
      transactionKey: 1, transactionDate: '2026-11-03T10:00:00.000Z', accountKey: { accountKey: 1, accountName: 'Checking', currencyKey: { code: 'EUR' } },
      description: 'Coffee shop', appuserSettlementAmount: -4.5, appuserCurrencyKey: { code: 'EUR' }, reviewed: false, appuserTransactionCategories: [], recurringSeries: null,
    }] })
    mocks.reviewSummary = loaded({ count: 2, currency: 'EUR', totalAbs: 90 })
    const view = await renderRoute()
    expect(view.getByText('2 transactions to review · €90.00 in total')).toBeOnTheScreen()
  })

  it('shows a bank alert that reconnects through the bank connections screen and dismisses', async () => {
    mockBankAlertBanner = {
      primary: { id: 'a1', kind: 'consent_revoked', institutionName: 'Banco X', bankId: 'BX', expiresAt: null, daysUntilExpiry: null, failingSince: null },
      moreCount: 0,
      ids: ['a1'],
    }
    const view = await renderRoute()
    expect(view.getByText('Banco X ended access early')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Reconnect' }))
    expect(mockPush).toHaveBeenCalledWith('/more/banking')
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss' }))
    expect(mockDismissBankAlert).toHaveBeenCalled()
  })

  it('opens the net worth trend', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'View net worth trend' }))
    expect(mockPush).toHaveBeenCalledWith('/net-worth/history')
  })

  it('maps each budget’s current month into a row, and links to that month', async () => {
    mocks.budgets = loaded({ budgets: [budget(7, 'Household')] })
    mockMonths = [loaded({
      budget: budget(7, 'Household', [{
        category_amount: 550, category_bg_color: null, category_budgeted_amount: 0, category_icon: null, category_is_system_category: false,
        category_key: 11, category_text_color: null, parent_category_name: 'FOOD', category_recurrency: null, child_category_name: null,
        category_rolled_over: 0, category_available: 0, category_rollover_enabled: false, category_rollover_incomplete: false,
      }, {
        category_amount: 550, category_bg_color: null, category_budgeted_amount: 500, category_icon: null, category_is_system_category: false,
        category_key: 12, category_text_color: null, parent_category_name: 'FOOD', category_recurrency: 'MONTHLY', child_category_name: 'GROCERIES',
        category_rolled_over: 0, category_available: 500, category_rollover_enabled: false, category_rollover_incomplete: false,
      }]),
      hasNextMonth: false,
      hasPreviousMonth: true,
    })]
    const view = await renderRoute()
    expect(view.getByText('over the plan')).toBeOnTheScreen()
    expect(view.getByText('1 category over plan')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('link', { name: 'Household' }))
    expect(mockPush).toHaveBeenCalledWith(`/budgets/7/${now.getFullYear()}/${now.getMonth() + 1}`)
  })

  it('shows the setup checklist from accounts, reviewed transactions, budgets and portfolios', async () => {
    const view = await renderRoute()
    // An account exists; nothing else does yet.
    expect(view.getByText('1 of 4 steps complete')).toBeOnTheScreen()
  })

  it('hides the setup checklist once dismissed', async () => {
    mockDismissed = true
    const view = await renderRoute()
    expect(view.queryByText('Finish setting up your dashboard')).toBeNull()
  })

  it('keeps the rest of Home when one section fails', async () => {
    mocks.loans = { ...idle(), error: new Error('boom') }
    const view = await renderRoute()
    expect(view.getByText('Error loading data')).toBeOnTheScreen()
    expect(view.getByLabelText(/^Net worth, €1,200\.00, EUR/)).toBeOnTheScreen()
  })

  it('shows the top spending category when one is returned', async () => {
    mocks.insight = loaded({ categorySpending: [{ categoryKey: 1, name: 'Groceries', amount: 420, currency: 'EUR', numTransactions: 12, isSystemCategory: false, childCategories: [] }] })
    const view = await renderRoute()
    expect(view.getByText('Groceries — €420.00 this month')).toBeOnTheScreen()
  })

  describe('"Is this the same money?"', () => {
    const brokerage = { accountKey: 21, accountName: 'Brokerage cash', accountType: 'INVESTMENT', source: 'manual', refreshedAt: null }
    const checking = { accountKey: 22, accountName: 'Checking', accountType: 'CHECKING', source: 'open_banking', refreshedAt: null }
    const suggested = () => {
      mocks.netWorth = loaded({ ...netWorthData, suggestPortfolioLink: true })
      mocks.accounts = loaded({ accounts: [checking, brokerage] })
      mocks.portfolios = loaded({ portfolios: [
        { portfolioKey: 7, name: 'Long term', accountLink: null },
        { portfolioKey: 8, name: 'Already linked', accountLink: { accountKey: 22, accountName: 'Checking', mode: 'cash_only' } },
      ] })
    }

    it('shows on the balance sheet when the API suggests it', async () => {
      suggested()
      const view = await renderRoute()
      const nudge = within(view.getByTestId('home-portfolio-link-suggestion'))
      expect(nudge.getByText('Is this the same money?')).toBeOnTheScreen()
      expect(within(view.getByTestId('home-balance-sheet')).getByTestId('home-portfolio-link-suggestion')).toBeOnTheScreen()
    })

    it.each([
      // The API answers false for a pair either member linked and for an account only the other member can see.
      ['the API does not suggest it', () => { mocks.netWorth = loaded({ ...netWorthData, suggestPortfolioLink: false }) }],
      ['an older API sends no answer', () => { mocks.netWorth = loaded(netWorthData) }],
      ['it was dismissed on this device', () => { mockLinkDismissal = { dismissed: true, loaded: true } }],
      ['the dismissal has not been read yet', () => { mockLinkDismissal = { dismissed: false, loaded: false } }],
    ])('stays hidden when %s', async (_label, arrange) => {
      suggested()
      arrange()
      const view = await renderRoute()
      expect(view.queryByText('Is this the same money?')).toBeNull()
    })

    it('dismisses on this device', async () => {
      suggested()
      const view = await renderRoute()
      await fireEvent.press(within(view.getByTestId('home-portfolio-link-suggestion')).getByRole('button', { name: 'Dismiss' }))
      expect(mockDismissLink).toHaveBeenCalledTimes(1)
    })

    it('links an unlinked portfolio to the account that holds it', async () => {
      suggested()
      mockLinkMutate.mockResolvedValue({ portfolio: { portfolioKey: 7 } })
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Link a portfolio' }))
      const sheet = within(view.getByTestId('home-portfolio-link-sheet'))
      expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled()

      await fireEvent.press(sheet.getByRole('button', { name: /^Portfolio,/ }))
      // Only the portfolio with no link is offered.
      expect(view.queryByRole('radio', { name: 'Already linked' })).toBeNull()
      await fireEvent.press(view.getByRole('radio', { name: 'Long term' }))

      await fireEvent.press(sheet.getByRole('button', { name: /^Account that holds this portfolio,/ }))
      const options = view.getAllByRole('radio').map((option) => option.props.accessibilityLabel)
      // The investment account leads the list.
      expect(options).toEqual(['Not linked', 'Brokerage cash', 'Checking'])
      await fireEvent.press(view.getByRole('radio', { name: 'Brokerage cash' }))
      // A manual account starts on "Yes, it includes them".
      expect(sheet.getByRole('button', { name: "Does this account's balance include your investments?, Yes, it includes them" })).toBeOnTheScreen()

      await fireEvent.press(sheet.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(mockLinkMutate).toHaveBeenCalledWith({ portfolioId: 7, accountLink: { accountId: 21, mode: 'includes_holdings' } }))
      await waitFor(() => expect(view.queryByTestId('home-portfolio-link-sheet')).toBeNull())
    })

    it('names the member who holds the link, and nothing about their account', async () => {
      suggested()
      mockLinkMutate.mockRejectedValue(new ApiError('portfolio-link-held', 403, { linkedBy: 'Ana' }))
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Link a portfolio' }))
      const sheet = within(view.getByTestId('home-portfolio-link-sheet'))
      await fireEvent.press(sheet.getByRole('button', { name: /^Portfolio,/ }))
      await fireEvent.press(view.getByRole('radio', { name: 'Long term' }))
      await fireEvent.press(sheet.getByRole('button', { name: /^Account that holds this portfolio,/ }))
      await fireEvent.press(view.getByRole('radio', { name: 'Checking' }))
      await fireEvent.press(sheet.getByRole('button', { name: 'Save' }))
      expect(await sheet.findByText('Already linked by Ana')).toBeOnTheScreen()
      expect(view.getByTestId('home-portfolio-link-sheet')).toBeOnTheScreen()
    })

    it('says a demo cannot link', async () => {
      suggested()
      mockLinkMutate.mockRejectedValue(new ApiError('demo-forbidden', 403))
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Link a portfolio' }))
      const sheet = within(view.getByTestId('home-portfolio-link-sheet'))
      await fireEvent.press(sheet.getByRole('button', { name: /^Portfolio,/ }))
      await fireEvent.press(view.getByRole('radio', { name: 'Long term' }))
      await fireEvent.press(sheet.getByRole('button', { name: /^Account that holds this portfolio,/ }))
      await fireEvent.press(view.getByRole('radio', { name: 'Brokerage cash' }))
      await fireEvent.press(sheet.getByRole('button', { name: 'Save' }))
      expect(await sheet.findByText('Linking is unavailable in demo mode')).toBeOnTheScreen()
    })
  })
})
