import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { PRIVACY_MASK } from '@/lib/formatters/money-display'
import { PrivacyModeProvider, renderedText } from '@/test/privacy-mode'

import { HoldingDetailScreen, type HoldingDetailViewState } from './holding-detail-screen'

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined) }))

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

  it('shows the realized gain beside the unrealized one, signed, including a gain of zero', async () => {
    const gained = await renderScreen({ status: 'loaded', holding: { ...holding, realizedGain: 35 }, activity: [], refreshing: false })
    expect(gained.view.getByLabelText('Realized gain, +€35.00')).toBeOnTheScreen()
    gained.view.unmount()
    const lost = await renderScreen({ status: 'loaded', holding: { ...holding, realizedGain: -12.5 }, activity: [], refreshing: false })
    expect(lost.view.getByLabelText(/^Realized gain, -€12\.50$/)).toBeOnTheScreen()
    lost.view.unmount()
    const never = await renderScreen({ status: 'loaded', holding: { ...holding, realizedGain: 0 }, activity: [], refreshing: false })
    expect(never.view.getByLabelText('Realized gain, €0.00')).toBeOnTheScreen()
  })

  it('hides the realized gain when there is no figure for it', async () => {
    for (const realizedGain of [null, undefined]) {
      const { view } = await renderScreen({ status: 'loaded', holding: { ...holding, realizedGain }, activity: [], refreshing: false })
      expect(view.getByLabelText(/^Gain or loss, /)).toBeOnTheScreen()
      expect(view.queryByLabelText(/^Realized gain/)).not.toBeOnTheScreen()
      view.unmount()
    }
  })

  it('shows an empty state when the holding has no activity', async () => {
    const { view } = await renderScreen({ status: 'loaded', holding, activity: [], refreshing: false })
    expect(view.getByText('No transactions for this holding yet')).toBeOnTheScreen()
  })

  it('lists this holding\'s own activity rows, including stock splits', async () => {
    const activity = [
      { amount: 1100, cashCurrency: null, currency: 'EUR', id: 't1', itemType: 'TRANSACTION' as const, name: 'Apple Inc.', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: 10, split: null, ticker: 'AAPL', timestamp: '2026-07-20T00:00:00.000Z', transactionKey: 1, type: 'BUY', typeLabel: 'Buy', unitPrice: 110 },
      { amount: null, cashCurrency: null, currency: null, id: 's1', itemType: 'STOCK_SPLIT' as const, name: 'Apple Inc.', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: null, split: { denominator: 1, numerator: 4, ratio: 4 }, ticker: 'AAPL', timestamp: '2026-07-21T00:00:00.000Z', transactionKey: null, type: null, typeLabel: null, unitPrice: null },
    ]
    const { view } = await renderScreen({ status: 'loaded', holding, activity, refreshing: false })
    expect(view.getByText('Buy')).toBeOnTheScreen()
    expect(view.getAllByText('€1,100.00').length).toBeGreaterThanOrEqual(1)
    expect(view.getByText('Stock split')).toBeOnTheScreen()
  })

  describe('privacy mode', () => {
    const position = { ...holding, quantity: 37.5 }
    const buy = { amount: 4125, cashCurrency: null, currency: 'EUR', id: 't1', itemType: 'TRANSACTION' as const, name: 'Apple Inc.', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: 37.5, split: null, ticker: 'AAPL', timestamp: '2026-07-20T00:00:00.000Z', transactionKey: 1, type: 'BUY', typeLabel: 'Buy', unitPrice: 110 }
    const state: HoldingDetailViewState = { status: 'loaded', holding: position, activity: [buy], refreshing: false }

    async function renderWithPrivacy(hidden: boolean) {
      const i18n = await initMobileI18n('en')
      const props = { state, onBack: jest.fn(), onRefresh: jest.fn(), onLogout: jest.fn() }
      return render(<I18nextProvider i18n={i18n}><PrivacyModeProvider hidden={hidden}><HoldingDetailScreen {...props} /></PrivacyModeProvider></I18nextProvider>)
    }

    it('shows the quantity with the mode off (the control for the test below)', async () => {
      const view = await renderWithPrivacy(false)
      expect(await view.findByText('Quantity 37.5')).toBeOnTheScreen()
      expect(renderedText(view.toJSON())).toContain('37.5')
    })

    it('masks the held and traded quantity, since quantity times price is the value', async () => {
      const view = await renderWithPrivacy(true)
      expect(await view.findByText(`Quantity ${PRIVACY_MASK}`)).toBeOnTheScreen()
      expect(renderedText(view.toJSON())).not.toMatch(/37[.,]5/)
    })
  })
})
