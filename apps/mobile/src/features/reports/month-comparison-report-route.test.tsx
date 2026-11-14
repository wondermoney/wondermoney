import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { MonthComparisonReportRoute } from './month-comparison-report-route'

const mockReplace = jest.fn()
const mockRefetch = jest.fn()
const mockUseMonthComparisonReport = jest.fn((..._args: unknown[]) => mockQuery)

const BASE_MONTH = '2026-08'
const COMPARE_MONTH = '2026-07'

const responseData = {
  data: {
    base: { expenses: 1150, income: 2020, month: BASE_MONTH, net: 870, savingsRate: 0.43 },
    categories: [{ base: 150, categoryKey: '10', color: '#f3f3f3', compare: 100, delta: 50, deltaPct: 50, name: 'Groceries' }],
    compare: { expenses: 1000, income: 2000, month: COMPARE_MONTH, net: 1000, savingsRate: 0.5 },
  },
  generatedAt: '2026-08-11T00:00:00.000Z',
  filters: {},
}

let mockQuery: { data?: unknown; isLoading: boolean; isFetching: boolean; isAccessTransition: boolean; error: unknown; refetch: jest.Mock } = {
  data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-month-comparison-report', () => ({
  useMonthComparisonMonths: () => ({ base: '2026-08', compare: '2026-07', setBase: jest.fn(), setCompare: jest.fn() }),
  useMonthComparisonReport: (...args: unknown[]) => mockUseMonthComparisonReport(...args),
}))
jest.mock('./use-reports-currency', () => ({ useReportsCurrency: () => 'EUR' }))
jest.mock('./use-report-filter-options', () => ({ useReportFilterOptions: () => ({ accounts: [], categories: [], merchants: [], currencies: [] }) }))
jest.mock('./use-report-export', () => ({ useReportExport: () => ({ state: { status: 'idle' }, exportCsv: jest.fn() }) }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><MonthComparisonReportRoute /></I18nextProvider>)
}

describe('MonthComparisonReportRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockRefetch.mockReset()
    mockUseMonthComparisonReport.mockClear()
    mockQuery = { data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch }
  })

  it('maps a loaded response into the screen', async () => {
    const view = await renderRoute()
    expect(view.getByText('Compare months')).toBeOnTheScreen()
    expect(view.getByText('Groceries')).toBeOnTheScreen()
  })

  it('asks for the two months the pickers hold', async () => {
    await renderRoute()
    await waitFor(() => expect(mockUseMonthComparisonReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ base: BASE_MONTH, compare: COMPARE_MONTH }),
    ))
  })

  it('surfaces invalid-response distinctly and navigates back to the reports hub', async () => {
    mockQuery = { ...mockQuery, data: undefined, error: new ApiError('invalid-response') }
    const view = await renderRoute()
    expect(view.getByText('The report data received could not be verified')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/reports')
  })
})
