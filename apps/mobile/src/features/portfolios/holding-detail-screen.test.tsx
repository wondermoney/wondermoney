import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { HoldingDetailScreen, type HoldingDetailViewState } from './holding-detail-screen'

const holding = {
  allocation: 12.5, averageBuyPrice: 90, currency: 'EUR', currentPrice: 110, currentValue: 1100,
  gain: 200, gainPercent: 22.2, id: 8, isInvalid: false, name: 'Apple Inc.', quantity: 10, symbol: 'AAPL', type: 'Stock',
}

async function renderScreen(state: HoldingDetailViewState, overrides: Partial<React.ComponentProps<typeof HoldingDetailScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof HoldingDetailScreen> = { state, onBack: jest.fn(), onRefresh: jest.fn(), onLogout: jest.fn(), ...overrides }
  const view = await render(<I18nextProvider i18n={i18n}><HoldingDetailScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('HoldingDetailScreen', () => {
  it('shows a loading state', async () => {
    const { view } = await renderScreen({ status: 'loading' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('renders nothing during an access transition', async () => {
    const { view } = await renderScreen({ status: 'access-transition' })
    expect(view.toJSON()).toBeNull()
  })

  it('shows a not-found failure without a retry action', async () => {
    const { view } = await renderScreen({ status: 'not-found' })
    expect(view.getByText('Holding not found')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
  })

  it('shows a retryable error failure', async () => {
    const onRetry = jest.fn()
    const { view } = await renderScreen({ status: 'error' }, { onRefresh: onRetry })
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders position metrics and an invalid-holding notice', async () => {
    const { view } = await renderScreen({ status: 'loaded', holding: { ...holding, isInvalid: true, currentValue: null, gain: null, currentPrice: null, averageBuyPrice: null }, activity: [], refreshing: false })
    expect(view.getByText('AAPL')).toBeOnTheScreen()
    expect(view.getByText('Apple Inc. · Stock')).toBeOnTheScreen()
    expect(view.getByText(/units are inconsistent/i)).toBeOnTheScreen()
    expect(view.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(3)
  })

  it('renders real position metrics when the holding is valid', async () => {
    const { view } = await renderScreen({ status: 'loaded', holding, activity: [], refreshing: false })
    expect(view.getByText('€1,100.00')).toBeOnTheScreen()
    expect(view.getByLabelText(/Portfolio weight, \+12.5%/)).toBeOnTheScreen()
  })

  it('shows an empty state when the holding has no activity', async () => {
    const { view } = await renderScreen({ status: 'loaded', holding, activity: [], refreshing: false })
    expect(view.getByText('No transactions for this holding yet')).toBeOnTheScreen()
  })

  it('lists this holding\'s own activity rows, including stock splits', async () => {
    const activity = [
      { amount: 1100, currency: 'EUR', id: 't1', itemType: 'TRANSACTION' as const, name: 'Apple Inc.', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: 10, split: null, ticker: 'AAPL', timestamp: '2026-07-20T00:00:00.000Z', transactionKey: 1, type: 'BUY', unitPrice: 110 },
      { amount: null, currency: null, id: 's1', itemType: 'STOCK_SPLIT' as const, name: 'Apple Inc.', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: null, split: { denominator: 1, numerator: 4, ratio: 4 }, ticker: 'AAPL', timestamp: '2026-07-21T00:00:00.000Z', transactionKey: null, type: null, unitPrice: null },
    ]
    const { view } = await renderScreen({ status: 'loaded', holding, activity, refreshing: false })
    expect(view.getByText('Buy')).toBeOnTheScreen()
    expect(view.getAllByText('€1,100.00').length).toBeGreaterThanOrEqual(1)
    expect(view.getByText('Stock split')).toBeOnTheScreen()
  })
})
