import type { NetWorthDto } from './net-worth-contract'
import { mapNetWorthSummary } from './net-worth-view-model'

const dto = (loans: number, portfolios: number): NetWorthDto => ({
  currencyCode: 'GBP',
  totalNetWorth: 701,
  assets: { accounts: 500, portfolios: 300 },
  liabilities: { loans: 99 },
  rows: [
    { type: 'portfolios', name: 'Second category first', balance: 300 },
    { type: 'loans', name: 'Loan', balance: -99 },
    { type: 'accounts', name: 'Account', balance: 500 },
  ],
  unsupportedCurrencies: { loans, portfolios },
})

describe('mapNetWorthSummary', () => {
  it('preserves server values, category values, row order, counters, and negative loan balance', () => {
    const input = dto(0, 0)

    expect(mapNetWorthSummary(input)).toEqual({
      ...input,
      completeness: 'unknown',
    })
    expect(mapNetWorthSummary(input).rows.map(({ type }) => type)).toEqual([
      'portfolios',
      'loans',
      'accounts',
    ])
    expect(mapNetWorthSummary(input).rows[1].balance).toBe(-99)
  })

  it.each([
    [1, 0],
    [0, 1],
    [2, 3],
  ])('marks unsupported currency counters %s/%s as partial', (loans, portfolios) => {
    expect(mapNetWorthSummary(dto(loans, portfolios)).completeness).toBe('partial')
  })

  it('never infers complete when unsupported counters are zero', () => {
    expect(mapNetWorthSummary(dto(0, 0)).completeness).toBe('unknown')
  })
})
