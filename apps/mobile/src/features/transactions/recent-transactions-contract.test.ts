import { createRecentTransactionsEndpoint, recentTransactionsResponseSchema } from './recent-transactions-contract'

const persisted = { entryType: 'persisted_transaction', occurredAt: '2026-06-10T09:00:00.000Z', displayName: 'Blue Bottle', amount: -12.5, currencyCode: 'EUR' }
const synthetic = { entryType: 'synthetic_initial_balance', occurredAt: null, displayName: null, amount: 250, currencyCode: 'USD' }

describe('recent transactions contract', () => {
  it('accepts the five-field persisted and synthetic shapes', () => {
    expect(recentTransactionsResponseSchema.parse({ transactions: [persisted, synthetic] }).transactions).toHaveLength(2)
  })

  it('rejects any extra/sensitive field (strict) and a malformed currency', () => {
    expect(recentTransactionsResponseSchema.safeParse({ transactions: [{ ...persisted, transactionKey: 1 }] }).success).toBe(false)
    expect(recentTransactionsResponseSchema.safeParse({ transactions: [{ ...persisted, currencyCode: 'eur' }] }).success).toBe(false)
  })

  it('keeps null amount and currency explicit and preserves zero', () => {
    expect(recentTransactionsResponseSchema.parse({ transactions: [{ ...persisted, amount: 0 }] }).transactions[0].amount).toBe(0)
    expect(recentTransactionsResponseSchema.parse({ transactions: [{ ...persisted, amount: null, currencyCode: null }] }).transactions[0].amount).toBeNull()
  })

  it('builds the dedicated path endpoint with no query filters', () => {
    const endpoint = createRecentTransactionsEndpoint(42)
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/account/42/recent-transactions')
  })
})
