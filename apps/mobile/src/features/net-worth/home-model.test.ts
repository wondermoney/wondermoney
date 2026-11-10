import {
  balanceSheet,
  cashflowScale,
  chartScale,
  daysLeftInMonth,
  formatCompactMoney,
  netWorthChanges,
  oldestRefresh,
  upcomingLoanPayments,
} from './home-model'
import { mapNetWorthSummary } from './net-worth-view-model'

describe('home model', () => {
  const today = new Date(2026, 10, 5)

  it('measures net worth against the close of last month and of the oldest month', () => {
    const changes = netWorthChanges([
      { date: '2025-12-31', value: 100 },
      { date: '2026-10-15', value: 180 },
      { date: '2026-10-31', value: 200 },
      { date: '2026-11-05', value: 210 },
    ], 210, today)
    expect(changes.lastMonth).toEqual({ delta: 10, since: '2026-10-31' })
    expect(changes.overHistory).toEqual({ delta: 110, since: '2025-12-31' })
    expect(netWorthChanges([{ date: '2026-10-31', value: 200 }], 210, today).overHistory).toBeNull()
  })

  it('scales the axis from zero in two-significant-digit steps', () => {
    expect(chartScale([110_000, 136_530])).toEqual({ min: 0, max: 140_000, ticks: [0, 35_000, 70_000, 105_000, 140_000] })
    const negative = chartScale([-50, 120])
    expect(negative.min).toBeLessThanOrEqual(-50)
    expect(negative.max).toBeGreaterThanOrEqual(120)
  })

  it('formats compact axis money with the suffix after the digits', () => {
    expect(formatCompactMoney(140_000, 'EUR', 'en')).toBe('€140K')
    expect(formatCompactMoney(0, 'EUR', 'en')).toBe('€0')
    expect(formatCompactMoney(1_500_000, 'EUR', 'en')).toBe('€1.5M')
  })

  it('moves loans and negative balances to the owed side, as positives', () => {
    const sheet = balanceSheet([
      { type: 'accounts', name: 'Checking', balance: 1000 },
      { type: 'accounts', name: 'Card', balance: -200 },
      { type: 'loans', name: 'Car', balance: 300 },
      { type: 'portfolios', name: 'ISA', balance: 50 },
    ])
    expect(sheet.ownTotal).toBe(1050)
    expect(sheet.oweTotal).toBe(500)
    expect(sheet.own.map((group) => group.type)).toEqual(['accounts', 'portfolios'])
    expect(sheet.owe.map((group) => group.type)).toEqual(['accounts', 'loans'])
  })

  it('groups manually valued assets on the owned side, after portfolios and counted in its total', () => {
    const sheet = balanceSheet([
      { type: 'manualAssets', id: 7, name: 'Family home', balance: 250_000 },
      { type: 'accounts', name: 'Checking', balance: 1000 },
      { type: 'portfolios', name: 'ISA', balance: 50 },
      { type: 'loans', name: 'Mortgage', balance: 180_000 },
    ])
    expect(sheet.own.map((group) => [group.type, group.total])).toEqual([['accounts', 1000], ['portfolios', 50], ['manualAssets', 250_000]])
    expect(sheet.ownTotal).toBe(251_050)
    expect(sheet.oweTotal).toBe(180_000)
  })

  it("keeps each row's record id, so an account row can wear its institution's mark", () => {
    const sheet = balanceSheet([
      { type: 'accounts', id: 41, name: 'Checking', balance: 1000 },
      { type: 'accounts', name: 'Older API', balance: 10 },
    ])
    expect(sheet.own[0]?.rows.map((row) => row.id)).toEqual([41, undefined])
  })

  it('lists a portfolio already inside its account balance without adding it to any total', () => {
    const sheet = balanceSheet([
      { type: 'accounts', id: 5, name: 'Brokerage', balance: 10000 },
      { type: 'portfolios', id: 7, name: 'Shares', balance: 8000, countedInAccountId: 5 },
    ])
    expect(sheet.ownTotal).toBe(10000)
    expect(sheet.own[1]).toEqual({ type: 'portfolios', total: 0, rows: [{ key: 'portfolios:1', label: 'Shares', amount: 8000, id: 7, countedInAccountId: 5 }] })
  })

  it('diverges cash-flow bars from one zero line, oldest first', () => {
    const scale = cashflowScale([{ date: '2026-11-01T00:00:00.000Z', amount: 300 }, { date: '2026-10-01T00:00:00.000Z', amount: -100 }])
    expect(scale.zero).toBe(25)
    expect(scale.bars.map((bar) => bar.width)).toEqual([25, 75])
  })

  it('lists active loans due from today, soonest first', () => {
    const loan = (loanKey: number, nextPaymentDate: string | null, status = 'ACTIVE') => ({ loanKey, nextPaymentDate, status }) as never
    const due = upcomingLoanPayments([loan(1, '2026-12-01T00:00:00.000Z'), loan(2, '2026-11-01T00:00:00.000Z'), loan(3, '2026-11-20T00:00:00.000Z'), loan(4, '2026-11-10T00:00:00.000Z', 'CLOSED')], today)
    expect(due.map((item: { loanKey: number }) => item.loanKey)).toEqual([3, 1])
  })

  it('reports the oldest refresh and counts the days left', () => {
    const now = new Date('2026-11-05T12:00:00.000Z')
    const oldest = oldestRefresh([{ refreshedAt: '2026-11-04T10:00:00.000Z' }, { refreshedAt: null }, { refreshedAt: '2026-11-05T11:00:00.000Z' }], now)
    expect(oldest?.toISOString()).toBe('2026-11-04T10:00:00.000Z')
    expect(oldestRefresh([{ refreshedAt: null }], now)).toBeNull()
    expect(daysLeftInMonth(today)).toBe(25)
  })
  it('tolerates partial or missing data instead of throwing', () => {
    expect(balanceSheet(undefined)).toEqual({ own: [], owe: [], ownTotal: 0, oweTotal: 0 })
    expect(balanceSheet(null)).toEqual({ own: [], owe: [], ownTotal: 0, oweTotal: 0 })
    const partial = balanceSheet([
      { type: 'accounts', name: 'Checking', balance: 1000 },
      { type: 'accounts', name: 'Broken' } as never,
      null as never,
    ])
    expect(partial.ownTotal).toBe(1000)
    expect(netWorthChanges(undefined, 210, today)).toEqual({ lastMonth: null, overHistory: null })
    expect(netWorthChanges([{ date: '2026-10-31', value: Number.NaN }], 210, today).lastMonth).toBeNull()
    expect(chartScale(undefined).min).toBe(0)
    expect(cashflowScale(undefined)).toEqual({ zero: 0, bars: [] })
    expect(upcomingLoanPayments(undefined, today)).toEqual([])
    expect(oldestRefresh(undefined, new Date())).toBeNull()
    expect(mapNetWorthSummary({ currencyCode: 'EUR', totalNetWorth: 5 } as never)).toMatchObject({ rows: [], completeness: 'unknown' })
  })
})
