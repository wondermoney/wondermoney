import { filterPortfolioActivityByTicker, mapPortfolioActivity, mapPortfolioDividendIncome } from './portfolio-activity-view-model'
import { portfolioActivityResponseSchema } from './portfolios-contract'

const completeSplit = {
  denominator: 1,
  editable: false as const,
  financialAssetKey: { financialAssetKey: 8, name: 'Apple', symbol: 'AAPL' },
  id: 'stock-split:complete',
  itemType: 'STOCK_SPLIT' as const,
  numerator: 4,
  portfolioKey: { name: 'Broker', portfolioKey: 3 },
  splitRatio: 4,
  transactionDate: '2026-07-19T00:00:00.000Z',
}

describe('portfolio activity view model stock splits', () => {
  it('preserves complete, explicit-null, omitted, and partial ratio values without deriving defaults', () => {
    const response = portfolioActivityResponseSchema.parse({
      transactions: [
        completeSplit,
        { ...completeSplit, id: 'stock-split:null', numerator: null, denominator: null, splitRatio: null },
        { ...completeSplit, id: 'stock-split:omitted', numerator: undefined, denominator: undefined, splitRatio: undefined },
        { ...completeSplit, id: 'stock-split:partial-a', denominator: null },
        { ...completeSplit, id: 'stock-split:partial-b', numerator: undefined, splitRatio: null },
      ],
    })
    const rows = mapPortfolioActivity(response.transactions)
    expect(rows[0]?.split).toEqual({ numerator: 4, denominator: 1, ratio: 4 })
    expect(rows[1]?.split).toEqual({ numerator: null, denominator: null, ratio: null })
    expect(rows[2]?.split).toEqual({ numerator: null, denominator: null, ratio: null })
    expect(rows[3]?.split).toEqual({ numerator: 4, denominator: null, ratio: 4 })
    expect(rows[4]?.split).toEqual({ numerator: null, denominator: 1, ratio: null })
    expect(rows.every((row) => row.itemType === 'STOCK_SPLIT')).toBe(true)
  })

  it('keeps valid normal activity beside an incomplete read-only split', () => {
    const response = portfolioActivityResponseSchema.parse({ transactions: [
      { financialAssetKey: { financialAssetKey: 9, name: 'Fund', symbol: 'FND' }, portfolioKey: { name: 'Broker', portfolioKey: 3 }, quantity: 2, settlementAmount: 20, transactionDate: '2026-07-20T00:00:00.000Z', transactionKey: 5 },
      { ...completeSplit, numerator: null },
    ] })
    const rows = mapPortfolioActivity(response.transactions)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ itemType: 'TRANSACTION', quantity: 2, amount: 20 })
    expect(rows[1]).toMatchObject({ itemType: 'STOCK_SPLIT', split: { numerator: null, denominator: 1, ratio: 4 } })
  })

  it('carries a real transaction its editable id, but never a stock split', () => {
    const response = portfolioActivityResponseSchema.parse({ transactions: [
      { financialAssetKey: { financialAssetKey: 9, name: 'Fund', symbol: 'FND' }, portfolioKey: { name: 'Broker', portfolioKey: 3 }, quantity: 2, settlementAmount: 20, transactionDate: '2026-07-20T00:00:00.000Z', transactionKey: 5 },
      completeSplit,
    ] })
    const rows = mapPortfolioActivity(response.transactions)
    expect(rows[0]).toMatchObject({ transactionKey: 5, portfolioId: 3 })
    expect(rows[1]).toMatchObject({ transactionKey: null, portfolioId: 3 })
  })

  it('maps unitPrice from settlementUnitAmount, not settlementAmount, and carries notes through', () => {
    const response = portfolioActivityResponseSchema.parse({ transactions: [
      { financialAssetKey: { financialAssetKey: 9, name: 'Fund', symbol: 'FND' }, notes: 'Rebalanced from cash', portfolioKey: { name: 'Broker', portfolioKey: 3 }, quantity: 2, settlementAmount: 20, settlementUnitAmount: 10, transactionDate: '2026-07-20T00:00:00.000Z', transactionKey: 5 },
    ] })
    const rows = mapPortfolioActivity(response.transactions)
    expect(rows[0]).toMatchObject({ amount: 20, notes: 'Rebalanced from cash', unitPrice: 10 })
  })

  it('never invents unitPrice or notes on a stock split', () => {
    const rows = mapPortfolioActivity(portfolioActivityResponseSchema.parse({ transactions: [completeSplit] }).transactions)
    expect(rows[0]).toMatchObject({ unitPrice: null, notes: null })
  })

  it('filters rows down to a single ticker for holding drill-down', () => {
    const response = portfolioActivityResponseSchema.parse({ transactions: [
      { financialAssetKey: { financialAssetKey: 8, name: 'Apple', symbol: 'AAPL' }, portfolioKey: { name: 'Broker', portfolioKey: 3 }, quantity: 1, settlementAmount: 100, transactionDate: '2026-07-20T00:00:00.000Z', transactionKey: 1 },
      { financialAssetKey: { financialAssetKey: 9, name: 'Fund', symbol: 'FND' }, portfolioKey: { name: 'Broker', portfolioKey: 3 }, quantity: 1, settlementAmount: 50, transactionDate: '2026-07-21T00:00:00.000Z', transactionKey: 2 },
    ] })
    const rows = mapPortfolioActivity(response.transactions)
    expect(filterPortfolioActivityByTicker(rows, 'AAPL')).toEqual([expect.objectContaining({ transactionKey: 1 })])
    expect(filterPortfolioActivityByTicker(rows, 'MISSING')).toEqual([])
  })
})

describe('mapPortfolioDividendIncome', () => {
  it('maps the by-asset breakdown and total, keeping a valid reporting currency', () => {
    const dto = { byAsset: [{ financialAssetKey: 1, symbol: 'AAPL', totalDividends: 4 }], totalDividends: 4 }
    expect(mapPortfolioDividendIncome(dto, 'EUR')).toEqual({ currency: 'EUR', dividends: [{ symbol: 'AAPL', value: 4 }], totalDividends: 4 })
  })

  it('rejects a reporting currency that is not a real 3-letter code', () => {
    const dto = { byAsset: [], totalDividends: 0 }
    expect(mapPortfolioDividendIncome(dto, 'eur')).toMatchObject({ currency: null })
    expect(mapPortfolioDividendIncome(dto, null)).toMatchObject({ currency: null })
  })
})
