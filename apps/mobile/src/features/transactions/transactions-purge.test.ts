import { QueryClient } from '@tanstack/react-query'

import { purgeSensitiveState } from '@/lib/query/purge-sensitive-state'

import { transactionsKey } from './query-keys'

describe('transaction sensitive-state purge compatibility', () => {
  it('removes aggregate and account-filter financial rows', async () => {
    const client = new QueryClient()
    client.setQueryData(transactionsKey(4, { needsReview: true }), { transactions: [{ transactionKey: 41 }] })
    client.setQueryData(['transactions', 4, 'account', 7, {}], { transactions: [{ transactionKey: 42 }] })
    await purgeSensitiveState(client)
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })
})
