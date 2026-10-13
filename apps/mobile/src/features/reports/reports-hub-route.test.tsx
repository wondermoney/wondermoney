import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ReportsHubRoute } from './reports-hub-route'

// Real CartesianChart/Line render onto a Skia canvas, unavailable in this project's jest
// environment — same rationale/mock as portfolio-performance-chart.test.tsx.
jest.mock('victory-native', () => ({
  CartesianChart: (props: { children: (args: { points: { income: unknown; expenses: unknown; net: unknown; value: unknown } }) => React.ReactNode }) => props.children({ points: { income: [], expenses: [], net: [], value: [] } }),
  Line: () => null,
}))

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-report-filter-options', () => ({ useReportFilterOptions: () => ({ accounts: [], categories: [], merchants: [], currencies: [] }) }))
jest.mock('./use-reports-currency', () => ({ useReportsCurrency: () => 'EUR' }))
jest.mock('./use-report-export', () => ({ useReportExport: () => ({ state: { status: 'idle' }, exportCsv: jest.fn() }) }))

type MockQuery = { data?: unknown; priorData?: unknown; priorReady?: boolean; isLoading: boolean; isFetching: boolean; isAccessTransition: boolean; error: unknown; refetch: jest.Mock }

const idleQuery = (): MockQuery => ({ data: undefined, isLoading: true, isFetching: false, isAccessTransition: false, error: null, refetch: jest.fn() })

let mockSankeyQuery = idleQuery()
let mockCashflowQuery = idleQuery()
let mockSpendingQuery: MockQuery = { ...idleQuery(), priorData: undefined, priorReady: false }
let mockNetWorthQuery = idleQuery()
let mockBudgetQuery = idleQuery()
let mockPortfolioQuery = idleQuery()

jest.mock('./use-sankey-report', () => ({ useSankeyReport: () => mockSankeyQuery }))
jest.mock('./use-cashflow-report', () => ({ useCashflowReport: () => mockCashflowQuery }))
jest.mock('./use-spending-by-category-report', () => ({ useSpendingByCategoryReport: () => mockSpendingQuery }))
jest.mock('./use-net-worth-history-report', () => ({ useNetWorthHistoryReport: () => mockNetWorthQuery }))
jest.mock('./use-budget-vs-actual', () => ({ useBudgetVsActualReport: () => mockBudgetQuery }))
jest.mock('./use-portfolio-performance-report', () => ({ usePortfolioPerformanceReport: () => mockPortfolioQuery }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><ReportsHubRoute /></I18nextProvider>)
}

describe('ReportsHubRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockSankeyQuery = idleQuery()
    mockCashflowQuery = idleQuery()
    mockSpendingQuery = { ...idleQuery(), priorData: undefined, priorReady: false }
    mockNetWorthQuery = idleQuery()
    mockBudgetQuery = idleQuery()
    mockPortfolioQuery = idleQuery()
  })

  it('shows a loading state per section while every report is still loading', async () => {
    const view = await renderRoute()
    expect(view.getByLabelText('Loading cash flow flows')).toBeTruthy()
    expect(view.getByLabelText('Loading cash flow')).toBeTruthy()
    expect(view.getByLabelText('Loading portfolio performance')).toBeTruthy()
  })

  it("does not let one report's failure block the others from loading", async () => {
    mockSankeyQuery = { data: undefined, isLoading: false, isFetching: false, isAccessTransition: false, error: new Error('boom'), refetch: jest.fn() }
    mockCashflowQuery = { data: { data: [{ month: '2026-07-01', income: 2000, expenses: 1500, net: 500 }], generatedAt: '2026-08-11T00:00:00.000Z', filters: {} }, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: jest.fn() }
    const view = await renderRoute()
    expect(view.getByText('Check your connection and try again')).toBeOnTheScreen()
    expect(view.getByLabelText('+€500.00 trailing 3-month net average')).toBeTruthy()
  })

  it('replaces with More on back', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/more')
  })
})
