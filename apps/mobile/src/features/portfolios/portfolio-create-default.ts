import type { PortfolioCurrencyDto } from './portfolios-contract'

const isCurrencyCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value)

export function selectPortfolioDefaultCurrency(
  currencies: readonly PortfolioCurrencyDto[],
  reportingCode: unknown,
  accountCode: unknown,
): number | null {
  const available = new Map(currencies.map((currency) => [currency.code, currency.currencyKey]))
  for (const candidate of [reportingCode, accountCode]) {
    if (isCurrencyCode(candidate) && available.has(candidate)) return available.get(candidate)!
  }
  return available.get('EUR') ?? null
}
