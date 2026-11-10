import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { PortfolioDetailScreen } from './portfolio-detail-screen'
import { PortfoliosScreen } from './portfolios-screen'
import type { PortfolioDetailViewModel, PortfolioOverviewViewModel } from './portfolios-view-model'

const overview: PortfolioOverviewViewModel = { assetCount: 2, currency: 'EUR', periodReturn: 12.4, portfolioCount: 1, portfolios: [{ currency: 'EUR', description: null, gainPercent: -3.2, id: 3, name: 'Broker', nativeCurrency: 'USD', value: 120 }], totalGainLoss: -4, totalGainLossPercent: -3.2, totalValue: 120 }
const detail: PortfolioDetailViewModel = { assetCount: 1, bestPerformer: null, biggestPosition: null, currency: 'EUR', description: null, holdingsCount: 0, id: 3, name: 'Broker', nativeCurrency: 'USD', periodReturn: null, totalGainLoss: 0, totalGainLossPercent: 0, totalValue: 120, holdings: [{ allocation: null, averageBuyPrice: null, currency: 'EUR', currentPrice: null, currentValue: null, gain: null, gainPercent: null, id: 8, isInvalid: true, name: 'Example', quantity: -2, symbol: 'EXM', type: 'Stock' }] }
const performanceProps = { state: { status: 'loading' as const }, period: 'YTD' as const, onSelectPeriod: jest.fn() }

async function provider(node: React.ReactNode) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('portfolio screens', () => {
  it('shows API currencies and converts percentage points once', async () => {
    const select = jest.fn()
    const add = jest.fn()
    const create = jest.fn()
    const view = await provider(<PortfoliosScreen state={{ status: 'loaded', data: overview }} onCreatePortfolio={create} onAddTransaction={add} onRefresh={jest.fn()} onLogout={jest.fn()} onSelectPortfolio={select} />)
    expect(view.getAllByText(/€120\.00/).length).toBeGreaterThan(0)
    expect(view.getAllByText(/-3\.2%/).length).toBeGreaterThan(0)
    expect(view.queryByText(/-320/)).not.toBeOnTheScreen()
    await fireEvent.press(view.getByTestId('portfolio-row'))
    expect(select).toHaveBeenCalledWith(3)
    // One "+" in the title row lists both add actions; there is no second add button.
    expect(view.queryByRole('button', { name: 'Add transaction' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Create portfolio' })).not.toBeOnTheScreen()
    // One portfolio: "Add transaction" goes straight to it, as web's modal preselects it.
    await fireEvent.press(view.getByRole('button', { name: 'Add' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Add transaction' }))
    expect(add).toHaveBeenCalledWith(3)
    await fireEvent.press(view.getByRole('button', { name: 'Add' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Create portfolio' }))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('leads with four summary figures and drives the period and the add flow from the header', async () => {
    const two: PortfolioOverviewViewModel = { ...overview, periodLabel: 'YTD', realizedGains: 0, unrealizedGains: 18.5, totalGainLoss: 20, totalGainLossPercent: 21, periodReturn: 17.06, portfolioCount: 2, portfolios: [...overview.portfolios, { ...overview.portfolios[0]!, id: 4, name: 'Tech picks' }] }
    const period = jest.fn()
    const add = jest.fn()
    const view = await provider(<PortfoliosScreen state={{ status: 'loaded', data: two }} onSelectPeriod={period} onAddTransaction={add} onRefresh={jest.fn()} onLogout={jest.fn()} onSelectPortfolio={jest.fn()} />)
    const summary = view.getByTestId('portfolio-summary')
    for (const label of ['Total Value', 'Total Gain/Loss', 'YTD Return', 'Unrealized Gains']) expect(within(summary).getByText(label)).toBeOnTheScreen()
    // The overview keeps to four figures (a 2×2 grid); the realized figure lives on each portfolio.
    expect(within(summary).queryByText('Realized Gains')).not.toBeOnTheScreen()
    expect(view.queryByText(/This is a summary of your portfolios/)).not.toBeOnTheScreen()
    expect(view.getByText('2 Portfolios')).toBeOnTheScreen()
    expect(view.getByText('+17.06%')).toBeOnTheScreen()
    expect(view.getByText('Portfolio Breakdown')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: /Timeframe/ }))
    await fireEvent.press(view.getByRole('radio', { name: '1 Month' }))
    expect(period).toHaveBeenCalledWith('1M')
    // Two portfolios: the same sheet lists them under "Add transaction".
    await fireEvent.press(view.getByRole('button', { name: 'Add' }))
    expect(view.getByText('Add transaction')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('menuitem', { name: 'Tech picks' }))
    expect(add).toHaveBeenCalledWith(4)
  })

  it('keeps invalid holdings visible and every valuation unavailable rather than zero', async () => {
    const activity = jest.fn()
    const settings = jest.fn()
    const view = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} onBack={jest.fn()} onOpenSettings={settings} onOpenActivity={activity} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    const invalid = view.getByTestId('invalid-holding')
    expect(invalid).toBeOnTheScreen()
    expect(view.getByText('Needs attention')).toBeOnTheScreen()
    // Value and gain both read as missing (an em dash), never as a zero.
    expect(within(invalid).getAllByText('—')).toHaveLength(2)
    expect(within(invalid).queryByText(/€0\.00/)).not.toBeOnTheScreen()
    expect(invalid.props.accessibilityLabel).toMatch(/Current value Unavailable.*Gain or loss Unavailable/)
    await fireEvent.press(view.getByRole('button', { name: 'View activity' }))
    expect(activity).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'More for this portfolio' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Portfolio settings' }))
    expect(settings).toHaveBeenCalledTimes(1)
    const holdingTap = jest.fn()
    const withHolding = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} onBack={jest.fn()} onOpenActivity={jest.fn()} onOpenHolding={holdingTap} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    await fireEvent.press(withHolding.getByTestId('invalid-holding'))
    expect(holdingTap).toHaveBeenCalledWith(8)
  })

  it('lists each holding as one row: symbol and name, value right, gain or loss beneath', async () => {
    const priced = { ...detail, holdingsCount: 1, holdings: [{ allocation: 20.6, averageBuyPrice: 104.54, currency: 'EUR', currentPrice: 99.16, currentValue: 2578.16, gain: -139.75, gainPercent: -5.14, id: 11, isInvalid: false, name: 'Apple Inc.', quantity: 26, symbol: 'AAPL', type: 'Stock' }] }
    const open = jest.fn()
    const view = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: priced }} performance={performanceProps} onBack={jest.fn()} onOpenActivity={jest.fn()} onOpenHolding={open} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    const row = view.getByTestId('holding-row')
    expect(within(row).getByText('AAPL')).toBeOnTheScreen()
    expect(within(row).getByText('Apple Inc.')).toBeOnTheScreen()
    expect(within(row).getByText('-€139.75 · -5.1%')).toBeOnTheScreen()
    // Price, average cost and quantity belong to the holding screen the row opens.
    expect(within(row).queryByText(/99\.16|104\.54|Quantity/)).not.toBeOnTheScreen()
    await fireEvent.press(row)
    expect(open).toHaveBeenCalledWith(11)
  })

  it('keeps adding on the floating button and the secondary actions behind the title row menu', async () => {
    const add = jest.fn()
    const settings = jest.fn()
    const importTransactions = jest.fn()
    const view = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} onBack={jest.fn()} onOpenActivity={jest.fn()} onOpenAddTransaction={add} onOpenImport={importTransactions} onOpenSettings={settings} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    const group = view.getByTestId('portfolio-secondary-actions')
    expect(within(group).getByRole('button', { name: 'View activity' })).toBeOnTheScreen()
    expect(within(group).queryByRole('button', { name: 'Import transactions' })).not.toBeOnTheScreen()
    // Settings and import are in the ⋮ menu, not on the title row or in the list.
    expect(view.queryByRole('button', { name: 'Portfolio settings' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'More for this portfolio' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Import transactions' }))
    expect(importTransactions).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'More for this portfolio' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Portfolio settings' }))
    expect(settings).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByTestId('portfolio-detail-add'))
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('never shows the dividend-income section until a real state is supplied', async () => {
    const view = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(view.queryByText('Dividend Income')).not.toBeOnTheScreen()
  })

  it('shows per-portfolio dividend income once loaded, and no section when there is none (as web)', async () => {
    const loaded = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'loaded', data: { currency: 'EUR', dividends: [{ symbol: 'AAPL', value: 4 }], totalDividends: 4 } }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(loaded.getByText('Dividend Income')).toBeOnTheScreen()
    expect(loaded.getByLabelText('Total dividends, €4.00')).toBeOnTheScreen()
    expect(loaded.getByLabelText('AAPL, €4.00')).toBeOnTheScreen()

    const empty = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'loaded', data: { currency: 'EUR', dividends: [], totalDividends: 0 } }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(empty.queryByText('Dividend Income')).not.toBeOnTheScreen()
  })

  it('never lets a loading or failed dividend read hold up the rest of the page', async () => {
    const loading = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'loading' }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(loading.getAllByText('Holdings').length).toBeGreaterThan(0)

    const error = await provider(<PortfolioDetailScreen state={{ status: 'loaded', data: detail }} performance={performanceProps} dividendIncome={{ status: 'error' }} onBack={jest.fn()} onOpenActivity={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(error.queryByText('Dividend Income')).not.toBeOnTheScreen()
    expect(error.getAllByText('Holdings').length).toBeGreaterThan(0)
  })

  it('keeps empty states informational and suppresses all chrome during access transition', async () => {
    const empty = await provider(<PortfoliosScreen state={{ status: 'loaded', data: { ...overview, portfolioCount: 0, portfolios: [] } }} onRefresh={jest.fn()} onLogout={jest.fn()} onSelectPortfolio={jest.fn()} />)
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
