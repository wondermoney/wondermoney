import { mapPortfolioDetail, mapPortfolioOverview } from './portfolios-view-model'

const summary = { assetCount: 1, currency: 'EUR' as const, lastUpdated: '2026-07-19T10:00:00.000Z', periodLabel: 'YTD' as const, periodReturn: 12.4, realizedGains: 2, totalGainLoss: 20, totalGainLossPercent: 10, totalValue: 220, unrealizedGains: 18 }

describe('portfolio view models', () => {
  it('keeps API user-currency totals and native metadata separate without local sums', () => {
    const result = mapPortfolioOverview(
      { portfolios: [{ appuserCurrencyCode: 'EUR', balance: 999, currencyKey: { code: 'USD' }, name: 'Broker', portfolioKey: 1 }] },
      { portfolios: [{ currency: 'EUR', gainPercent: 10, name: 'Broker', portfolioKey: 1, value: 220, weight: 100 }], summary: { ...summary, portfolioCount: 1 } },
    )
    expect(result.totalValue).toBe(220)
    expect(result.portfolios[0]).toMatchObject({ value: 220, currency: 'EUR', nativeCurrency: 'USD' })
  })

  it('maps invalid holdings to null financial values and never zero-valued fallbacks', () => {
    const result = mapPortfolioDetail(
      { portfolio: { currencyKey: { code: 'USD' }, name: 'Broker', portfolioKey: 1 } },
      { quickStats: { bestPerformer: null, biggestPosition: null, holdingsCount: 0, worstPerformer: null }, summary },
      { holdings: [{ allocation: null, averageBuyPrice: 0, currency: 'EUR', currentPrice: null, currentValue: null, financialAssetKey: 8, financialAssetName: 'Example', financialAssetSymbol: 'EXM', financialAssetType: 'Stock', invalidReason: 'NEGATIVE_UNITS', isInvalid: true, quantity: -2, relatedTransactionKeys: [4], unrealizedGains: null, unrealizedGainsPercentage: null }] },
    )
    expect(result.holdings[0]).toMatchObject({ isInvalid: true, averageBuyPrice: null, currentPrice: null, currentValue: null, gain: null, gainPercent: null })
  })
})
