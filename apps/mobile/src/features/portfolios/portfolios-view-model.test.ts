import { portfoliosResponseSchema } from './portfolios-contract'
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

  it('counts every household portfolio even when the summary counts only the caller\'s own', () => {
    const result = mapPortfolioOverview(
      { portfolios: [
        { appuserCurrencyCode: 'EUR', balance: 220, currencyKey: { code: 'EUR' }, name: 'Long-term', portfolioKey: 7 },
        { appuserCurrencyCode: 'EUR', balance: 80, currencyKey: { code: 'EUR' }, name: 'Tech picks', portfolioKey: 8 },
      ] },
      { portfolios: [{ currency: 'EUR', gainPercent: 10, name: 'Long-term', portfolioKey: 7, value: 220, weight: 100 }], summary: { ...summary, portfolioCount: 1 } },
    )
    expect(result.portfolioCount).toBe(2)
  })

  it('names each portfolio\'s broker from the list, and reads a server that sends none as no broker', () => {
    const list = portfoliosResponseSchema.parse({ portfolios: [
      { appuserCurrencyCode: 'EUR', balance: 220, broker: { displayName: 'Degiro', id: 1, name: 'degiro' }, currencyKey: { code: 'EUR' }, name: 'Long-term', portfolioKey: 7 },
      { appuserCurrencyCode: 'EUR', balance: 80, currencyKey: { code: 'EUR' }, name: 'By hand', portfolioKey: 8 },
    ] })
    const result = mapPortfolioOverview(list, {
      portfolios: [
        { currency: 'EUR', gainPercent: 10, name: 'Long-term', portfolioKey: 7, value: 220, weight: 73 },
        { currency: 'EUR', gainPercent: 0, name: 'By hand', portfolioKey: 8, value: 80, weight: 27 },
      ],
      summary: { ...summary, portfolioCount: 2 },
    })
    expect(result.portfolios.map((portfolio) => portfolio.brokerName)).toEqual(['Degiro', null])
  })

  it('maps invalid holdings to null financial values and never zero-valued fallbacks', () => {
    const result = mapPortfolioDetail(
      { portfolio: { currencyKey: { code: 'USD' }, name: 'Broker', portfolioKey: 1 } },
      { quickStats: { bestPerformer: null, biggestPosition: null, holdingsCount: 0, worstPerformer: null }, summary },
      { holdings: [{ allocation: null, averageBuyPrice: 0, currency: 'EUR', currentPrice: null, currentValue: null, financialAssetKey: 8, financialAssetName: 'Example', financialAssetSymbol: 'EXM', financialAssetType: 'Stock', invalidReason: 'NEGATIVE_UNITS', isInvalid: true, quantity: -2, relatedTransactionKeys: [4], unrealizedGains: null, unrealizedGainsPercentage: null }] },
    )
    expect(result.holdings[0]).toMatchObject({ isInvalid: true, averageBuyPrice: null, currentPrice: null, currentValue: null, gain: null, gainPercent: null, realizedGain: null })
  })

  it('carries each holding\'s realized gain, keeping 0 and reading a missing figure as null', () => {
    const base = { allocation: 50, averageBuyPrice: 90, currency: 'EUR', currentPrice: 110, currentValue: 1100, financialAssetName: 'Example', financialAssetType: 'Stock', quantity: 10, unrealizedGains: 200, unrealizedGainsPercentage: 22.2 }
    const result = mapPortfolioDetail(
      { portfolio: { currencyKey: { code: 'EUR' }, name: 'Broker', portfolioKey: 1 } },
      { quickStats: { bestPerformer: null, biggestPosition: null, holdingsCount: 3, worstPerformer: null }, summary },
      { holdings: [
        { ...base, financialAssetKey: 1, financialAssetSymbol: 'AAA', realizedGains: 42.5 },
        { ...base, financialAssetKey: 2, financialAssetSymbol: 'BBB', realizedGains: 0 },
        { ...base, financialAssetKey: 3, financialAssetSymbol: 'CCC' },
      ] },
    )
    expect(result.holdings.map((holding) => holding.realizedGain)).toEqual([42.5, 0, null])
  })

  it('carries the period\'s time- and money-weighted returns on both screens, and none from an older API', () => {
    const list = { portfolios: [{ appuserCurrencyCode: 'EUR', balance: 220, currencyKey: { code: 'EUR' }, name: 'Long-term', portfolioKey: 7 }] }
    const quickStats = { bestPerformer: null, biggestPosition: null, holdingsCount: 1, worstPerformer: null }
    const metadata = { portfolio: { currencyKey: { code: 'EUR' }, name: 'Long-term', portfolioKey: 7 } }
    const periodReturns = { timeWeighted: 8.5, moneyWeighted: -1.25, moneyWeightedAnnualized: true, missingSnapshotDates: ['2026-03-01', '2026-03-02', '2026-03-02'] }
    const overview = mapPortfolioOverview(list, { portfolios: [], summary: { ...summary, portfolioCount: 1, periodReturns } })
    const detail = mapPortfolioDetail(metadata, { quickStats, summary: { ...summary, periodReturns } }, { holdings: [] })
    for (const result of [overview, detail]) {
      expect(result.periodReturns).toEqual({ timeWeighted: 8.5, moneyWeighted: -1.25, moneyWeightedAnnualized: true, missingSnapshotDays: 2 })
    }
    const unmeasured = mapPortfolioDetail(metadata, { quickStats, summary: { ...summary, periodReturns: { timeWeighted: null, moneyWeighted: null, moneyWeightedAnnualized: false, missingSnapshotDates: [] } } }, { holdings: [] })
    expect(unmeasured.periodReturns).toEqual({ timeWeighted: null, moneyWeighted: null, moneyWeightedAnnualized: false, missingSnapshotDays: 0 })
    expect(mapPortfolioOverview(list, { portfolios: [], summary: { ...summary, portfolioCount: 1 } }).periodReturns).toBeUndefined()
    expect(mapPortfolioDetail(metadata, { quickStats, summary }, { holdings: [] }).periodReturns).toBeUndefined()
  })
})
