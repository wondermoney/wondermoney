import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { NetWorthRoute } from './net-worth-route'

const mockPush = jest.fn()
const netWorthData = {
  totalNetWorth: 1200,
  currencyCode: 'EUR',
  completeness: 'unknown' as const,
  assets: { accounts: 1500, portfolios: 0 },
  liabilities: { loans: 0 },
  unsupportedCurrencies: { loans: 0, portfolios: 0 },
  rows: [],
}

let mockNetWorth: Record<string, unknown> = { isLoading: false, data: netWorthData, isRefreshFailure: false, error: null, refetch: jest.fn() }
let mockBudgets: Record<string, unknown> = { isLoading: false, data: undefined, isRefreshFailure: false, error: null, refetch: jest.fn() }
let mockInsight: Record<string, unknown> = { isLoading: false, isAccessTransition: false, data: undefined, error: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: jest.fn() }) }))
jest.mock('./use-net-worth', () => ({ useNetWorth: () => mockNetWorth }))
jest.mock('@/features/budgets/use-budgets', () => ({ useBudgets: () => mockBudgets }))
jest.mock('@/features/account-insights/use-top-spending-category', () => ({ useTopSpendingCategory: () => mockInsight }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><NetWorthRoute /></I18nextProvider>)
}

describe('NetWorthRoute budget health wiring', () => {
  beforeEach(() => {
    mockNetWorth = { isLoading: false, data: netWorthData, isRefreshFailure: false, error: null, refetch: jest.fn() }
    mockBudgets = { isLoading: false, data: undefined, isRefreshFailure: false, error: null, refetch: jest.fn() }
    mockInsight = { isLoading: false, isAccessTransition: false, data: undefined, error: null }
  })

  it('shows a loading placeholder while budgets are loading, independent of net worth', async () => {
    mockBudgets = { ...mockBudgets, isLoading: true }
    const view = await renderRoute()
    expect(view.getByRole('progressbar', { name: 'Loading budget health' })).toBeOnTheScreen()
  })

  it('shows nothing when there is no budget for the current calendar period', async () => {
    const now = new Date()
    mockBudgets = { ...mockBudgets, data: { budgets: [{ budgetKey: 1, name: 'Old', description: null, currencyCode: 'EUR', year: now.getFullYear() - 1, month: 1, categories: [], accounts: [], incomes: [] }] } }
    const view = await renderRoute()
    expect(view.queryByText('Budget health')).not.toBeOnTheScreen()
  })

  it('shows the current-period budget totals when present', async () => {
    const now = new Date()
    mockBudgets = {
      ...mockBudgets,
      data: {
        budgets: [{
          budgetKey: 7,
          name: 'This month',
          description: null,
          currencyCode: 'EUR',
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          accounts: [],
          incomes: [],
          categories: [],
        }],
      },
    }
    const view = await renderRoute()
    expect(view.getByRole('header', { name: 'Budget health' })).toBeOnTheScreen()
  })

  it('shows a scoped error state without blocking net worth when budgets fail to load', async () => {
    mockBudgets = { ...mockBudgets, isLoading: false, data: undefined, error: new Error('boom') }
    const view = await renderRoute()
    expect(view.getByText('Could not load budget health')).toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'At a glance' })).toBeOnTheScreen()
  })
})

describe('NetWorthRoute insights wiring', () => {
  beforeEach(() => {
    mockNetWorth = { isLoading: false, data: netWorthData, isRefreshFailure: false, error: null, refetch: jest.fn() }
    mockBudgets = { isLoading: false, data: undefined, isRefreshFailure: false, error: null, refetch: jest.fn() }
    mockInsight = { isLoading: false, isAccessTransition: false, data: undefined, error: null }
  })

  it('shows nothing when no category spending was returned for the period', async () => {
    mockInsight = { ...mockInsight, data: { categorySpending: [] } }
    const view = await renderRoute()
    expect(view.queryByText('Insights')).not.toBeOnTheScreen()
  })

  it('shows the top category from the response', async () => {
    mockInsight = { ...mockInsight, data: { categorySpending: [{ categoryKey: 1, name: 'Groceries', amount: 420, currency: 'EUR', numTransactions: 12 }] } }
    const view = await renderRoute()
    expect(view.getByRole('header', { name: 'Insights' })).toBeOnTheScreen()
    expect(view.getByText('Groceries — €420.00 this month')).toBeOnTheScreen()
  })

  it('shows a loading placeholder independently of net worth and budget health', async () => {
    mockInsight = { ...mockInsight, isLoading: true }
    const view = await renderRoute()
    expect(view.getByRole('progressbar', { name: 'Loading insights' })).toBeOnTheScreen()
  })

  it('shows a scoped error without blocking the rest of the dashboard', async () => {
    mockInsight = { ...mockInsight, error: new Error('boom') }
    const view = await renderRoute()
    expect(view.getByText('Could not load insights')).toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'At a glance' })).toBeOnTheScreen()
  })
})
