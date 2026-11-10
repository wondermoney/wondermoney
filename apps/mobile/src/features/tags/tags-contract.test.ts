import { freezeManualTransaction } from '@/features/transactions/manual-transaction-contract'
import { transactionsKey } from '@/features/transactions/query-keys'
import { transactionFixture } from '@/features/transactions/test-fixtures'
import { aggregateTransactionsResponseSchema, createAccountTransactionsEndpoint, createAggregateTransactionsEndpoint } from '@/features/transactions/transactions-contract'
import { mapTransactions } from '@/features/transactions/transactions-view-model'

import { createSetTransactionTagsEndpoint, DEFAULT_TAG_COLOR, freezeTagIds, sameTagName, tagsResponseSchema } from './tags-contract'

describe('tag contracts', () => {
  it('reads an unreadable or missing colour as the default grey instead of failing the list', () => {
    const { tags } = tagsResponseSchema.parse({ tags: [
      { tagKey: 1, name: 'Trip', color: '#EF4444' },
      { tagKey: 2, name: 'Work', color: 'red' },
      { tagKey: 3, name: 'Kids' },
    ] })
    expect(tags.map((tag) => tag.color)).toEqual(['#ef4444', DEFAULT_TAG_COLOR, DEFAULT_TAG_COLOR])
  })

  it('reads a row from a server without tags as untagged', () => {
    const [row] = aggregateTransactionsResponseSchema.parse({ transactions: [transactionFixture] }).transactions
    expect(row!.tags).toBeUndefined()
    expect(mapTransactions({ transactions: [row!] })[0]!.tags).toEqual([])
  })

  it('carries the tags on a row through to the view model', () => {
    const [row] = aggregateTransactionsResponseSchema.parse({ transactions: [{ ...transactionFixture, tags: [{ tagKey: 4, name: 'Holiday', color: '#22c55e' }] }] }).transactions
    expect(mapTransactions({ transactions: [row!] })[0]!.tags).toEqual([{ tagKey: 4, name: 'Holiday', color: '#22c55e' }])
  })

  it('asks the server to filter by tag, and keys the query by the set of tags', () => {
    expect(createAggregateTransactionsEndpoint({ tagIds: [3, 8] }).path).toBe('/v1/account/transaction?tagKeys=3%2C8')
    expect(createAggregateTransactionsEndpoint({ tagIds: [] }).path).toBe('/v1/account/transaction')
    expect(createAccountTransactionsEndpoint(7, { tagIds: [3] }).path).toBe('/v1/account/7/transaction?tagKeys=3&accountId=7')
    expect(transactionsKey(1, { tagIds: [8, 3] })).toEqual(transactionsKey(1, { tagIds: [3, 8] }))
    expect(transactionsKey(1, { tagIds: [3] })).not.toEqual(transactionsKey(1, {}))
  })

  it('sends tags with a manual transaction only when there are some', () => {
    const draft = { accountId: 7, transactionDate: '2026-07-19', transactionTypeId: 3, settlementAmount: '12.50', settlementCurrencyId: 151, existingMerchantId: 9 }
    const now = new Date('2026-07-20T10:00:00Z')
    expect(freezeManualTransaction({ ...draft, tagIds: [4, 4, 9] }, now).payload.tagIds).toEqual([4, 9])
    expect('tagIds' in freezeManualTransaction(draft, now).payload).toBe(false)
    expect('tagIds' in freezeManualTransaction({ ...draft, tagIds: [] }, now).payload).toBe(false)
  })

  it('bounds the tag list the way the API does', () => {
    expect(() => freezeTagIds([0])).toThrow()
    expect(() => freezeTagIds(Array.from({ length: 51 }, (_, index) => index + 1))).toThrow()
    expect(createSetTransactionTagsEndpoint(41)).toMatchObject({ method: 'PUT', path: '/v1/account/transaction/41/tags' })
  })

  it('compares names the way the API does', () => {
    expect(sameTagName(' Trip ', 'trip')).toBe(true)
    expect(sameTagName('Trip', 'Trips')).toBe(false)
  })
})
