import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { PortfolioDetailScreen } from './portfolio-detail-screen'
import { PortfoliosScreen } from './portfolios-screen'
import type { PortfolioDetailViewModel, PortfolioOverviewViewModel } from './portfolios-view-model'

const overview: PortfolioOverviewViewModel = { assetCount: 2, currency: 'EUR', periodReturn: 12.4, portfolioCount: 1, portfolios: [{ currency: 'EUR', description: null, gainPercent: -3.2, id: 3, name: 'Broker', nativeCurrency: 'USD', value: 120 }], totalGainLoss: -4, totalGainLossPercent: -3.2, totalValue: 120 }
const detail: PortfolioDetailViewModel = { assetCount: 1, bestPerformer: null, biggestPosition: null, currency: 'EUR', description: null, holdingsCount: 0, id: 3, name: 'Broker', nativeCurrency: 'USD', periodReturn: null, totalGainLoss: 0, totalGainLossPercent: 0, totalValue: 120, holdings: [{ allocation: null, averageBuyPrice: null, currency: 'EUR', currentPrice: null, currentValue: null, gain: null, gainPercent: null, id: 8, isInvalid: true, name: 'Example', quantity: -2, symbol: 'EXM', type: 'Stock' }] }
const analyticsProps = { analyticsState: { status: 'idle' as const }, onEnableAnalytics: jest.fn(), onRetryAnalytics: jest.fn(), onOpenActivity: jest.fn() }
const performanceProps = { state: { status: 'loading' as const }, period: 'YTD' as const, onSelectPeriod: jest.fn() }

async function provider(node: React.ReactNode) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('portfolio screens', () => {
  it('shows API currencies and converts percentage points once', async () => {
    const select = jest.fn()
    const activity = jest.fn()
    const create = jest.fn()
    const view = await provider(<PortfoliosScreen state={{ status: 'loaded', data: overview }} {...analyticsProps} onCreatePortfolio={create} onOpenActivity={activity} onRefresh={jest.fn()} onLogout={jest.fn()} onSelectPortfolio={select} />)
    expect(view.getAllByText(/€120\.00/).length).toBeGreaterThan(0)
    expect(view.getAllByText(/-3\.2%/).length).toBeGreaterThan(0)
    expect(view.queryByText(/-320/)).not.toBeOnTheScreen()
    await fireEvent.press(view.getByTestId('portfolio-row'))
    expect(select).toHaveBeenCalledWith(3)
    await fireEvent.press(view.getByRole('button', { name: 'Activity' }))
    expect(activity).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Create portfolio' }))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps invalid holdings visible and every valuation unavailable rather than zero', async () => {
    const activity = jest.fn()
    const settings = jest.fn()
    const view = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} onBack={jest.fn()} onOpenSettings={settings} onOpenActivity={activity} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    const invalid = view.getByTestId('invalid-holding')
    expect(invalid).toBeOnTheScreen()
    expect(view.getByText('Needs attention')).toBeOnTheScreen()
    expect(view.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(4)
    expect(within(invalid).queryByText(/€0\.00/)).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'View activity' }))
    expect(activity).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Portfolio settings' }))
    expect(settings).toHaveBeenCalledTimes(1)
    const holdingTap = jest.fn()
    const withHolding = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} onBack={jest.fn()} onOpenActivity={jest.fn()} onOpenHolding={holdingTap} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    await fireEvent.press(withHolding.getByTestId('invalid-holding'))
    expect(holdingTap).toHaveBeenCalledWith(8)
  })

  it('never shows the dividend-income section until a real state is supplied', async () => {
    const view = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(view.queryByText('Dividend income')).not.toBeOnTheScreen()
  })

  it('shows per-portfolio dividend income once loaded, and an empty note when there is none', async () => {
    const loaded = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'loaded', data: { currency: 'EUR', dividends: [{ symbol: 'AAPL', value: 4 }], totalDividends: 4 } }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(loaded.getByText('Dividend income')).toBeOnTheScreen()
    expect(loaded.getByLabelText('Total dividends, €4.00')).toBeOnTheScreen()
    expect(loaded.getByLabelText('AAPL, €4.00')).toBeOnTheScreen()

    const empty = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'loaded', data: { currency: 'EUR', dividends: [], totalDividends: 0 } }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(empty.getByText('No dividend income recorded for this portfolio yet')).toBeOnTheScreen()
  })

  it('surfaces loading and error states for dividend income independently of the rest of the page', async () => {
    const loading = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'loading' }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(loading.getByRole('progressbar', { name: 'Loading dividend income' })).toBeOnTheScreen()

    const error = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'error' }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(error.getByRole('alert')).toHaveTextContent('Could not load dividend income for this portfolio')
    expect(error.getAllByText('Holdings').length).toBeGreaterThan(0)
  })

  it('keeps empty states informational and suppresses all chrome during access transition', async () => {
    const empty = await provider(<PortfoliosScreen state={{ status: 'loaded', data: { ...overview, portfolioCount: 0, portfolios: [] } }} {...analyticsProps} onRefresh={jest.fn()} onLogout={jest.fn()} onSelectPortfolio={jest.fn()} />)
    expect(empty.getByText('No portfolios available')).toBeOnTheScreen()
    expect(empty.getByText('€24,680.50')).toBeOnTheScreen()
    expect(empty.getByText('Example allocation')).toBeOnTheScreen()
    expect(empty.getByText('AAPL')).toBeOnTheScreen()
    expect(empty.getByRole('button', { name: 'Create portfolio' })).toBeOnTheScreen()
    expect(empty.queryByText(/add|import|settings|delete/i)).not.toBeOnTheScreen()
    // The inner preview block is a background-step, not a second border
    // nested inside the outer empty-state card (No-Nesting rule). See
    // DESIGN_HISTORY.md's Known Cross-Platform Gaps.
    const previewBlock = empty.getByText('Total value preview').parent
    expect(StyleSheet.flatten(previewBlock?.props.style).borderWidth).toBeFalsy()
    const transition = await provider(<PortfolioDetailScreen state={{ status: 'access-transition' }} performance={performanceProps} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(transition.toJSON()).toBeNull()
  })
})
