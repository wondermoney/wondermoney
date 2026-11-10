import type { RecentTransactionDto } from './recent-transactions-contract'
import { mapRecentTransactions } from './recent-transactions-view-model'

const dto = (over: Partial<RecentTransactionDto> = {}): RecentTransactionDto => ({
  entryType: 'persisted_transaction',
  occurredAt: '2026-06-10T09:00:00.000Z',
  displayName: 'Coffee',
  amount: -5,
  currencyCode: 'EUR',
  ...over,
})

describe('mapRecentTransactions', () => {
  it('derives credit/debit from the amount sign and leaves zero/null without a direction', () => {
    const rows = mapRecentTransactions([
      dto({ amount: 10 }),
      dto({ amount: -10 }),
      dto({ amount: 0 }),
      dto({ amount: null }),
    ])
    expect(rows.map((row) => (row.kind === 'persisted' ? row.direction : 'n/a'))).toEqual(['credit', 'debit', null, null])
  })

  it('maps a synthetic initial balance without a display name or direction', () => {
    const [row] = mapRecentTransactions([dto({ entryType: 'synthetic_initial_balance', displayName: null, amount: 250, currencyCode: 'USD' })])
    expect(row).toEqual({ kind: 'synthetic-initial-balance', occurredAt: '2026-06-10T09:00:00.000Z', amount: 250, currencyCode: 'USD' })
  })

  it('carries through nullable display name, date, amount and currency verbatim', () => {
    const [row] = mapRecentTransactions([dto({ displayName: null, occurredAt: null, amount: null, currencyCode: null })])
    expect(row).toEqual({ kind: 'persisted', displayName: null, occurredAt: null, amount: null, currencyCode: null, direction: null, mark: { glyph: 'tag' } })
  })

  it('marks a row by its category, a transfer by arrows, and an uncategorised row with a muted tag', () => {
    const rows = mapRecentTransactions([
      dto({ category: { icon: 'coffee', bgColor: '#FEE2E2', textColor: '#991B1B' } }),
      dto({ transfer: true, category: { icon: 'coffee', bgColor: null, textColor: null } }),
      dto({ category: null }),
    ])
    expect(rows.map((row) => (row.kind === 'persisted' ? row.mark : null))).toEqual([
      { icon: { name: 'coffee', bgColor: '#FEE2E2', textColor: '#991B1B' } },
      { glyph: 'arrow-left-right' },
      { glyph: 'tag' },
    ])
  })
})
