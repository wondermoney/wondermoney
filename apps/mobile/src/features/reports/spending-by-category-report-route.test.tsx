import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { SpendingByCategoryReportRoute } from './spending-by-category-report-route'

const mockReplace = jest.fn()
const mockRefetch = jest.fn()

const responseData = {
  data: [{ categoryKey: 'a', parentKey: null, name: 'Groceries', color: '#111111', totalAmount: 150, transactionCount: 3, percentOfTotal: 100 }],
  generatedAt: '2026-08-11T00:00:00.000Z',
  filters: {},
}

let mockQuery: { data?: unknown; isLoading: boolean; isFetching: boolean; isAccessTransition: boolean; error: unknown; refetch: jest.Mock; priorData?: unknown; priorReady: boolean } = {
  data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch, priorData: undefined, priorReady: true,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-spending-by-category-report', () => ({ useSpendingByCategoryReport: (...args: unknown[]) => mockUseSpendingByCategoryReport(...args) }))
jest.mock('./use-reports-currency', () => ({ useReportsCurrency: () => 'EUR' }))
jest.mock('./use-report-filter-options', () => ({ useReportFilterOptions: () => ({ accounts: [], categories: [], merchants: [], currencies: [] }) }))
jest.mock('./use-report-export', () => ({ useReportExport: () => ({ state: { status: 'idle' }, exportCsv: jest.fn() }) }))

const mockUseSpendingByCategoryReport = jest.fn((..._args: unknown[]) => mockQuery)

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><SpendingByCategoryReportRoute /></I18nextProvider>)
}

describe('SpendingByCategoryReportRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockRefetch.mockReset()
    mockQuery = { data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch, priorData: undefined, priorReady: true }
  })

  it('maps a loaded response into the screen', async () => {
    const view = await renderRoute()
    expect(view.getByLabelText('Groceries, €150.00')).toBeTruthy()
  })

  it('surfaces invalid-response distinctly and navigates back to the reports hub', async () => {
    mockQuery = { ...mockQuery, data: undefined, error: new ApiError('invalid-response') }
    const view = await renderRoute()
    expect(view.getByText('The report data received could not be verified')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/reports')
  })
})
