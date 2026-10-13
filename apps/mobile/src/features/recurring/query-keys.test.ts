import { recurringItemsKey, recurringSummaryKey } from './query-keys'

describe('recurring query keys', () => {
  it('separates list and summary within each auth epoch', () => {
    expect(recurringItemsKey(4)).toEqual(['recurring', 4, 'items'])
    expect(recurringSummaryKey(4)).toEqual(['recurring', 4, 'summary'])
    expect(recurringItemsKey(4)).not.toEqual(recurringItemsKey(5))
    expect(recurringItemsKey(4)).not.toEqual(recurringSummaryKey(4))
  })
})
