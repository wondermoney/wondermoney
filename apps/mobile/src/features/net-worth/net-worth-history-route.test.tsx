import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { NetWorthHistoryRoute } from './net-worth-history-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn()
const mockHistory = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: jest.fn() }),
}))
jest.mock('./use-net-worth-history', () => ({ useNetWorthHistory: () => mockHistory() }))

const summary = {
  currencyCode: 'EUR', granularity: 'monthly', readiness: 'ready',
  points: [
    { date: '2026-01-01', totalNetWorth: 1000, accountsTotal: 1000, portfoliosTotal: 0, loansTotal: 0, isComplete: true },
    { date: '2026-02-01', totalNetWorth: 1500, accountsTotal: 1500, portfoliosTotal: 0, loansTotal: 0, isComplete: true },
  ],
}
const base = { data: summary, isLoading: false, isAccessTransition: false, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() }

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><NetWorthHistoryRoute /></I18nextProvider>)
}

describe('NetWorthHistoryRoute', () => {
  beforeEach(() => { mockReplace.mockReset(); mockBack.mockReset(); mockCanGoBack.mockReset(); mockHistory.mockReset() })

  it('maps the loaded summary into the trend screen', async () => {
    mockHistory.mockReturnValue(base)
    const view = await renderRoute()
    expect(view.getByRole('header', { name: 'Net worth trend' })).toBeOnTheScreen()
    expect(view.getAllByText(/up\s.*500/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders loading and error states from the query', async () => {
    mockHistory.mockReturnValue({ ...base, data: undefined, isLoading: true })
    const loading = await renderRoute()
    expect(loading.getByLabelText('Loading net worth trend')).toBeOnTheScreen()

    mockHistory.mockReturnValue({ ...base, data: undefined, isLoading: false })
    const errored = await renderRoute()
    expect(errored.getByRole('header', { name: 'Trend could not be loaded' })).toBeOnTheScreen()
  })

  it('falls back to Home when there is no navigation history', async () => {
    mockHistory.mockReturnValue(base)
    mockCanGoBack.mockReturnValue(false)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
  })
})
