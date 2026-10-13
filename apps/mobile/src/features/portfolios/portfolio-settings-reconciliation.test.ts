import { reconcilePortfolioSettings } from './portfolio-settings-reconciliation'

const detail = (overrides: Record<string, unknown> = {}) => ({ portfolio: { portfolioKey: 7, name: 'Normalized', description: 'Kept', currencyKey: { code: 'EUR' }, ...overrides } })

describe('portfolio settings reconciliation', () => {
  it('reports applied only when every retained sparse field matches exactly', () => {
    expect(reconcilePortfolioSettings(7, { name: 'Normalized', description: 'Kept' }, detail())).toBe('applied')
    expect(reconcilePortfolioSettings(7, { description: null }, detail({ description: null }))).toBe('applied')
    expect(reconcilePortfolioSettings(7, { description: null }, detail({ description: undefined }))).toBe('applied')
    expect(reconcilePortfolioSettings(7, { benchmarkSymbol: 'SPY' }, detail({ benchmarkSymbol: 'SPY' }))).toBe('applied')
    expect(reconcilePortfolioSettings(7, { benchmarkSymbol: null }, detail({ benchmarkSymbol: null }))).toBe('applied')
    expect(reconcilePortfolioSettings(7, { excluded: true }, detail({ excluded: true }))).toBe('applied')
    expect(reconcilePortfolioSettings(7, { favored: true }, detail({ favored: true }))).toBe('applied')
    expect(reconcilePortfolioSettings(7, { targetAllocation: { 'Equities': 60, 'Fixed Income': 40 } }, detail({ targetAllocation: { 'Fixed Income': 40, 'Equities': 60 } }))).toBe('applied')
    expect(reconcilePortfolioSettings(7, { targetAllocation: null }, detail({ targetAllocation: null }))).toBe('applied')
  })

  it('reports not applied only when every retained field differs', () => {
    expect(reconcilePortfolioSettings(7, { name: 'Other' }, detail())).toBe('not-applied')
    expect(reconcilePortfolioSettings(7, { description: null }, detail())).toBe('not-applied')
    expect(reconcilePortfolioSettings(7, { name: 'Other', description: 'Other' }, detail())).toBe('not-applied')
    expect(reconcilePortfolioSettings(7, { benchmarkSymbol: 'SPY' }, detail({ benchmarkSymbol: 'QQQ' }))).toBe('not-applied')
    expect(reconcilePortfolioSettings(7, { excluded: true }, detail({ excluded: false }))).toBe('not-applied')
    expect(reconcilePortfolioSettings(7, { targetAllocation: { 'Equities': 100 } }, detail({ targetAllocation: null }))).toBe('not-applied')
  })

  it('keeps mixed, malformed, and mismatched-id reads uncertain', () => {
    expect(reconcilePortfolioSettings(7, { name: 'Normalized', description: 'Other' }, detail())).toBe('uncertain')
    expect(reconcilePortfolioSettings(7, { name: 'Normalized' }, detail({ portfolioKey: 8 }))).toBe('uncertain')
    expect(reconcilePortfolioSettings(7, { name: 'Normalized' }, { portfolio: { portfolioKey: 7, name: 'Normalized' } })).toBe('uncertain')
    expect(reconcilePortfolioSettings(7, { name: '  Normalized  ' }, detail())).toBe('applied')
  })
})
