import { selectPortfolioDefaultCurrency } from './portfolio-create-default'

const currencies = [{ currencyKey: 1, code: 'EUR', description: 'Euro' }, { currencyKey: 2, code: 'USD', description: 'US Dollar' }]
describe('portfolio currency default', () => {
  it('uses only a validated available reporting or account code, then EUR', () => {
    expect(selectPortfolioDefaultCurrency(currencies, 'USD', 'EUR')).toBe(2)
    expect(selectPortfolioDefaultCurrency(currencies, 'usd', 'USD')).toBe(2)
    expect(selectPortfolioDefaultCurrency(currencies, 'GBP', 'CAD')).toBe(1)
  })
  it('requires explicit selection when no validated match and EUR is absent', () => {
    expect(selectPortfolioDefaultCurrency([currencies[1]], undefined, 'GBP')).toBeNull()
  })
})
