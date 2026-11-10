import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { PortfolioPerformanceReportRoute } from './portfolio-performance-report-route'

const mockReplace = jest.fn()
const mockRefetch = jest.fn()

const responseData = {
  data: [{ portfolioKey: '7', name: 'Long-term', currency: 'EUR', startValue: 1000, netContributions: 0, change: 100, changePercent: 10, dividends: 0, endValue: 1100 }],
  generatedAt: '2026-08-11T00:00:00.000Z',
  filters: {},
}

let mockQuery: { data?: unknown; isLoading: boolean; isFetching: boolean; isAccessTransition: boolean; error: unknown; refetch: jest.Mock } = {
  data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-portfolio-performance-report', () => ({ usePortfolioPerformanceReport: (...args: unknown[]) => mockUsePortfolioPerformanceReport(...args) }))
jest.mock('./use-reports-currency', () => ({ useReportsCurrency: () => 'EUR' }))
jest.mock('./use-report-export', () => ({ useReportExport: () => ({ state: { status: 'idle' }, exportCsv: jest.fn() }) }))

const mockUsePortfolioPerformanceReport = jest.fn((..._args: unknown[]) => mockQuery)

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><PortfolioPerformanceReportRoute /></I18nextProvider>)
}

describe('PortfolioPerformanceReportRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockRefetch.mockReset()
    mockQuery = { data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch }
  })

  it('maps a loaded response into the screen', async () => {
    const view = await renderRoute()
    expect(view.getByText('Long-term')).toBeOnTheScreen()
  })

  it('surfaces invalid-response distinctly and navigates back to the reports hub', async () => {
    mockQuery = { ...mockQuery, data: undefined, error: new ApiError('invalid-response') }
    const view = await renderRoute()
    expect(view.getByText('The report data received could not be verified')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/reports')
  })
})
