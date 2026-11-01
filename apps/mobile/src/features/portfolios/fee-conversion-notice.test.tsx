import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { HoldingDetailScreen } from './holding-detail-screen'
import { PortfolioDetailScreen } from './portfolio-detail-screen'
import { aggregateDashboardResponseSchema, aggregatePortfolioDashboardEndpoint, createPortfolioDashboardEndpoint } from './portfolios-contract'
import { PortfoliosScreen } from './portfolios-screen'
import { mapPortfolioOverview, type HoldingViewModel, type PortfolioDetailViewModel, type PortfolioOverviewViewModel } from './portfolios-view-model'

const holding: HoldingViewModel = {
  allocation: 100, averageBuyPrice: 100, currency: 'EUR', currentPrice: 110, currentValue: 110,
  gain: 10, gainPercent: 10, id: 8, isInvalid: false, name: 'Example ETF', quantity: 1, symbol: 'EXM', type: 'ETF',
}
const overview: PortfolioOverviewViewModel = { assetCount: 1, currency: 'EUR', periodReturn: 1, portfolioCount: 1, portfolios: [], totalGainLoss: 10, totalGainLossPercent: 10, totalValue: 110 }
const detail: PortfolioDetailViewModel = { assetCount: 1, bestPerformer: null, biggestPosition: null, currency: 'EUR', description: null, holdingsCount: 1, id: 3, name: 'Broker', nativeCurrency: 'EUR', periodReturn: null, totalGainLoss: 10, totalGainLossPercent: 10, totalValue: 110, holdings: [holding] }
const detailProps = { performance: { state: { status: 'loading' as const }, period: 'YTD' as const, onSelectPeriod: jest.fn() }, onBack: jest.fn(), onOpenActivity: jest.fn(), onRefresh: jest.fn(), onLogout: jest.fn() }
const overviewProps = { analyticsState: { status: 'idle' as const }, onEnableAnalytics: jest.fn(), onRetryAnalytics: jest.fn(), onOpenActivity: jest.fn(), onCreatePortfolio: jest.fn(), onRefresh: jest.fn(), onLogout: jest.fn(), onSelectPortfolio: jest.fn() }

async function renderIn(locale: string, node: React.ReactNode) {
  const i18n = await initMobileI18n(locale)
  return { i18n, view: await render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>) }
}

describe('fees left out of gains', () => {
  it.each(['en', 'pt-PT', 'es'])('says so on the gains of an affected portfolio and its overview (%s)', async (locale) => {
    const { i18n, view } = await renderIn(locale, <PortfolioDetailScreen state={{ status: 'loaded', data: { ...detail, feesLeftOut: true } }} {...detailProps} />)
    expect(view.getByLabelText(i18n.t('portfolioFees.gains'))).toBeOnTheScreen()

    const { view: overviewView } = await renderIn(locale, <PortfoliosScreen state={{ status: 'loaded', data: { ...overview, feesLeftOut: true } }} {...overviewProps} />)
    expect(overviewView.getByLabelText(i18n.t('portfolioFees.gains'))).toBeOnTheScreen()
  })

  it('marks only the affected holding, and its row announces why', async () => {
    const { i18n, view } = await renderIn('en', <PortfolioDetailScreen state={{ status: 'loaded', data: { ...detail, holdings: [{ ...holding, feeConversionIncomplete: true }, { ...holding, id: 9, symbol: 'OTH' }] } }} {...detailProps} />)
    const rows = view.getAllByTestId('holding-row')
    expect(rows[0]?.props.accessibilityLabel).toContain(i18n.t('portfolioFees.holding'))
    expect(rows[1]?.props.accessibilityLabel).not.toContain(i18n.t('portfolioFees.holding'))
    expect(view.getAllByText(i18n.t('portfolioFees.holdingLabel'))).toHaveLength(1)
  })

  it('explains the left-out fee on the holding detail', async () => {
    const { i18n, view } = await renderIn('en', <HoldingDetailScreen state={{ status: 'loaded', holding: { ...holding, feeConversionIncomplete: true }, activity: [], refreshing: false }} onBack={jest.fn()} onRefresh={jest.fn()} onLogout={jest.fn()} />)
    expect(view.getByText(i18n.t('portfolioFees.holding'))).toBeOnTheScreen()
  })

  it('shows nothing when every fee converted', async () => {
    const { view } = await renderIn('en', <PortfolioDetailScreen state={{ status: 'loaded', data: detail }} {...detailProps} />)
    expect(view.queryByTestId('fee-conversion-notice-gains')).not.toBeOnTheScreen()
    expect(view.queryByTestId('fee-conversion-notice-holding')).not.toBeOnTheScreen()
  })

  it('asks the API for the list and flags the overview when a fully sold asset is on it', () => {
    expect(aggregatePortfolioDashboardEndpoint.path).toContain('include=feeConversion')
    expect(createPortfolioDashboardEndpoint(7).path).toContain('include=feeConversion')

    const dashboard = aggregateDashboardResponseSchema.parse({
      portfolios: [],
      summary: {
        assetCount: 0, currency: 'EUR', feeConversionIncompleteAssetKeys: [4], lastUpdated: '2026-10-20T10:00:00.000Z', periodLabel: 'YTD',
        periodReturn: null, portfolioCount: 1, realizedGains: 12, totalGainLoss: 12, totalGainLossPercent: 12, totalValue: 0, unrealizedGains: 0,
      },
    })
    expect(mapPortfolioOverview({ portfolios: [] }, dashboard).feesLeftOut).toBe(true)
  })
})
