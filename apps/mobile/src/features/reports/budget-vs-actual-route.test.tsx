import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { BudgetVsActualRoute } from './budget-vs-actual-route'

const mockReplace = jest.fn()
const mockRefetch = jest.fn()

const responseData = {
  data: [{ categoryKey: 'groceries', name: 'Groceries', color: '#22c55e', budgeted: 400, actual: 320, variance: 80, percentUsed: 80 }],
  generatedAt: '2026-08-11T00:00:00.000Z',
  filters: {},
}

let mockQuery: { data?: unknown; isLoading: boolean; isFetching: boolean; isAccessTransition: boolean; error: unknown; refetch: jest.Mock } = {
  data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-budget-vs-actual', () => ({ useBudgetVsActualReport: (...args: unknown[]) => mockUseBudgetVsActualReport(...args) }))
jest.mock('./use-reports-currency', () => ({ useReportsCurrency: () => 'EUR' }))
jest.mock('./use-report-filter-options', () => ({ useReportFilterOptions: () => ({ accounts: [], categories: [], merchants: [], currencies: [] }) }))
jest.mock('./use-report-export', () => ({ useReportExport: () => ({ state: { status: 'idle' }, exportCsv: mockExportCsv }) }))

const mockUseBudgetVsActualReport = jest.fn((..._args: unknown[]) => mockQuery)
const mockExportCsv = jest.fn()

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><BudgetVsActualRoute /></I18nextProvider>)
}

describe('BudgetVsActualRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockRefetch.mockReset()
    mockExportCsv.mockReset()
    mockQuery = { data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch }
  })

  it('maps a loaded response into the screen', async () => {
    const view = await renderRoute()
    expect(view.getByText('Groceries')).toBeOnTheScreen()
  })

  it('wires the export button to useReportExport', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Export CSV' }))
    expect(mockExportCsv).toHaveBeenCalledTimes(1)
  })

  it('shows loading while the query is in flight', async () => {
    mockQuery = { ...mockQuery, data: undefined, isLoading: true }
    const view = await renderRoute()
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('surfaces an invalid-response error distinctly from a generic one', async () => {
    mockQuery = { ...mockQuery, data: undefined, error: new ApiError('invalid-response') }
    const view = await renderRoute()
    expect(view.getByText('The report data received could not be verified')).toBeOnTheScreen()
  })

  it('renders nothing during an access transition', async () => {
    mockQuery = { ...mockQuery, data: undefined, isAccessTransition: true }
    const view = await renderRoute()
    expect(view.toJSON()).toBeNull()
  })

  it('refetches on retry and navigates back to the reports hub', async () => {
    mockQuery = { ...mockQuery, data: undefined, error: new ApiError('network') }
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/reports')
  })
})
