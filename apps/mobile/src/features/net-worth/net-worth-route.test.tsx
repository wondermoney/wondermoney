import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

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
  useTransactions: (filters: { needsReview?: boolean }) => (filters.needsReview ? mocks.unreviewed : mocks.latest),
}))
jest.mock('@/features/account-insights/use-top-spending-category', () => ({ useTopSpendingCategory: () => mocks.insight }))
jest.mock('./use-home-data', () => ({
  useHomeBudgetMonths: () => mockMonths,
  useHomeCashflow: () => mocks.cashflow,
  useHomePortfolios: () => mocks.portfolios,
}))
let mockBankAlertBanner: unknown = null
const mockDismissBankAlert = jest.fn()
jest.mock('@/features/banking/use-bank-alerts', () => ({
  useBankAlertBanner: () => ({ banner: mockBankAlertBanner, dismiss: mockDismissBankAlert, refetch: jest.fn() }),
}))
jest.mock('./use-setup-checklist-dismissal', () => ({ useSetupChecklistDismissal: () => ({ dismissed: mockDismissed, dismiss: mockDismiss }) }))

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
    mockMonths = []
    mocks = {
      netWorth: loaded(netWorthData),
      history: loaded({ currencyCode: 'EUR', granularity: 'monthly', readiness: 'ready', points: [] }),
      accounts: loaded({ accounts: [{ accountKey: 1, refreshedAt: new Date(Date.now() - 26 * 3600_000).toISOString() }] }),
      budgets: loaded({ budgets: [] }),
      loans: loaded({ loans: [] }),
      latest: loaded({ transactions: [] }),
      unreviewed: loaded({ transactions: [], total: 0 }),
      insight: loaded({ categorySpending: [] }),
      cashflow: loaded({ cashflow: [] }),
      portfolios: loaded({ portfolios: [] }),
    }
  })

  it('renders Home with the figure and the oldest balance refresh', async () => {
    const view = await renderRoute()
    expect(view.getByLabelText(/^Net worth, €1,200\.00, EUR/)).toBeOnTheScreen()
    expect(view.getByText('Balances updated 1 day ago')).toBeOnTheScreen()
    expect(view.queryByTestId('home-bank-alert')).toBeNull()
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
})
