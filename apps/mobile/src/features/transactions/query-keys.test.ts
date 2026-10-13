import { accountTransactionsKey, transactionsKey, transactionsRootKey } from './query-keys'

describe('transaction query keys', () => {
  it('isolates epoch, endpoint, account, and retrieval filters', () => {
    const filters = { fromDate: '2026-07-01T00:00:00Z', needsReview: true }
    expect(transactionsRootKey(4)).toEqual(['transactions', 4])
    expect(transactionsKey(4, filters)).not.toEqual(transactionsKey(5, filters))
    expect(accountTransactionsKey(4, 7, filters)).not.toEqual(accountTransactionsKey(4, 8, filters))
    expect(accountTransactionsKey(4, 7, filters)).not.toEqual(transactionsKey(4, filters))
    expect(transactionsKey(4, filters)).not.toEqual(transactionsKey(4, {}))
    expect(transactionsKey(4, { includeHidden: true })).not.toEqual(transactionsKey(4, {}))
  })
})
