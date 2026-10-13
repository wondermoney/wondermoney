import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { HoldingDetailRoute } from './holding-detail-route'

const mockReplace = jest.fn()
const mockSignOut = jest.fn()
let mockParams: Record<string, string | string[] | undefined> = {}

const metadata = { portfolio: { portfolioKey: 3, name: 'Broker', description: null, currencyKey: { code: 'EUR' } } }
const dashboard = { quickStats: { bestPerformer: null, biggestPosition: null, holdingsCount: 1, worstPerformer: null }, summary: { assetCount: 1, currency: 'EUR', lastUpdated: '2026-07-19T10:00:00.000Z', periodLabel: 'YTD', periodReturn: null, realizedGains: 0, totalGainLoss: 0, totalGainLossPercent: 0, totalValue: 1100, unrealizedGains: 0 } }
const rawHolding = { allocation: 12.5, averageBuyPrice: 90, currency: 'EUR', currentPrice: 110, currentValue: 1100, financialAssetKey: 8, financialAssetName: 'Apple Inc.', financialAssetSymbol: 'AAPL', financialAssetType: 'Stock', quantity: 10, unrealizedGains: 200, unrealizedGainsPercentage: 22.2 }
const holdings = { holdings: [rawHolding] }
const activityResponse = { transactions: [
  { financialAssetKey: { financialAssetKey: 8, name: 'Apple Inc.', symbol: 'AAPL' }, financialTransactionTypeKey: { financialTransactionTypeKey: 1, name: 'BUY' }, portfolioKey: { name: 'Broker', portfolioKey: 3 }, quantity: 10, settlementAmount: 1100, transactionDate: '2026-07-20T00:00:00.000Z', transactionKey: 1 },
  { financialAssetKey: { financialAssetKey: 9, name: 'Fund', symbol: 'FND' }, portfolioKey: { name: 'Broker', portfolioKey: 3 }, quantity: 1, settlementAmount: 50, transactionDate: '2026-07-21T00:00:00.000Z', transactionKey: 2 },
] }

let mockDetail: { data?: unknown; isAccessTransition: boolean; isInitialLoading: boolean; isInvalidId: boolean; isNotFound: boolean; isRefreshing: boolean; refetch: jest.Mock } = {
  data: { dashboard, holdings, metadata }, isAccessTransition: false, isInitialLoading: false, isInvalidId: false, isNotFound: false, isRefreshing: false, refetch: jest.fn(),
}
let mockActivity: { data?: unknown; isAccessTransition: boolean; isInitialLoading: boolean; isRefreshing: boolean; refetch: jest.Mock } = {
  data: activityResponse, isAccessTransition: false, isInitialLoading: false, isRefreshing: false, refetch: jest.fn(),
}

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: mockSignOut }) }))
jest.mock('./use-portfolio-detail', () => ({ usePortfolioDetail: () => mockDetail }))
jest.mock('./use-portfolio-activity', () => ({ usePortfolioActivity: () => mockActivity }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><HoldingDetailRoute /></I18nextProvider>)
}

describe('HoldingDetailRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockSignOut.mockReset()
    mockParams = { portfolioId: '3', assetId: '8' }
    mockDetail = { data: { dashboard, holdings, metadata }, isAccessTransition: false, isInitialLoading: false, isInvalidId: false, isNotFound: false, isRefreshing: false, refetch: jest.fn() }
    mockActivity = { data: activityResponse, isAccessTransition: false, isInitialLoading: false, isRefreshing: false, refetch: jest.fn() }
  })

  it('finds the matching holding by asset id and filters activity to its ticker', async () => {
    const view = await renderRoute()
    expect(view.getByText('AAPL')).toBeOnTheScreen()
    expect(view.getByText('Buy')).toBeOnTheScreen()
    expect(view.queryByText('FND')).not.toBeOnTheScreen()
  })

  it('reports not-found for a malformed asset id without waiting on queries', async () => {
    mockParams = { portfolioId: '3', assetId: '0' }
    const view = await renderRoute()
    expect(view.getByText('Holding not found')).toBeOnTheScreen()
  })

  it('reports not-found when the asset id does not match any holding in this portfolio', async () => {
    mockParams = { portfolioId: '3', assetId: '99' }
    const view = await renderRoute()
    expect(view.getByText('Holding not found')).toBeOnTheScreen()
  })

  it('shows a loading state while either query is still pending', async () => {
    mockDetail = { ...mockDetail, data: undefined, isInitialLoading: true }
    const view = await renderRoute()
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })
})
