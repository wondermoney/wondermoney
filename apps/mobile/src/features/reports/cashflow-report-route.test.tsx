import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { customReportDateRange } from './report-date-presets'
import { CashflowReportRoute } from './cashflow-report-route'

jest.mock('victory-native', () => ({
  CartesianChart: (props: { children: (args: { points: { income: unknown; expenses: unknown; net: unknown } }) => React.ReactNode }) => props.children({ points: { income: [], expenses: [], net: [] } }),
  Line: () => null,
}))

const mockReplace = jest.fn()
const mockRefetch = jest.fn()

const responseData = {
  data: [{ month: '2026-07-01', income: 2000, expenses: 1500, net: 500 }],
  generatedAt: '2026-08-11T00:00:00.000Z',
  filters: {},
}

let mockQuery: { data?: unknown; isLoading: boolean; isFetching: boolean; isAccessTransition: boolean; error: unknown; refetch: jest.Mock } = {
  data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-cashflow-report', () => ({ useCashflowReport: (...args: unknown[]) => mockUseCashflowReport(...args) }))
jest.mock('./use-reports-currency', () => ({ useReportsCurrency: () => 'EUR' }))
jest.mock('./use-report-filter-options', () => ({ useReportFilterOptions: () => ({ accounts: [], categories: [], merchants: [], currencies: [] }) }))
jest.mock('./use-report-export', () => ({ useReportExport: () => ({ state: { status: 'idle' }, exportCsv: jest.fn() }) }))

const mockUseCashflowReport = jest.fn((..._args: unknown[]) => mockQuery)

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><CashflowReportRoute /></I18nextProvider>)
}

describe('CashflowReportRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockRefetch.mockReset()
    mockQuery = { data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch }
  })

  it('maps a loaded response into the screen', async () => {
    const view = await renderRoute()
    expect(view.getByLabelText('+€500.00 trailing 3-month net average')).toBeTruthy()
  })

  it('surfaces invalid-response distinctly and navigates back to the reports hub', async () => {
    mockQuery = { ...mockQuery, data: undefined, error: new ApiError('invalid-response') }
    const view = await renderRoute()
    expect(view.getByText('The report data received could not be verified')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/reports')
  })

  it('requests exactly the custom range the person picked', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Date range, Last 3 months' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Custom range' }))
    await fireEvent.changeText(view.getByLabelText('From'), '2026-08-03')
    await fireEvent.changeText(view.getByLabelText('To'), '2026-08-17')
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    const custom = customReportDateRange('2026-08-03', '2026-08-17')
    await waitFor(() => expect(mockUseCashflowReport).toHaveBeenLastCalledWith(expect.objectContaining({
      fromDate: custom.from.toISOString(),
      toDate: custom.to.toISOString(),
    })))
  })
})
