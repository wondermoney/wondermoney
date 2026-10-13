import { accountKey, accountsKey } from './query-keys'

describe('accountsKey', () => {
  it('contains only the accounts namespace and opaque epoch', () => {
    const epoch = 73
    expect(accountsKey(epoch)).toEqual(['accounts', epoch])
    expect(accountsKey(epoch)).toHaveLength(2)
  })
})

describe('accountKey', () => {
  it('isolates detail data by epoch and account id', () => {
    expect(accountKey(7, 42)).toEqual(['account', 7, 42])
    expect(accountKey(8, 42)).not.toEqual(accountKey(7, 42))
    expect(accountKey(7, 43)).not.toEqual(accountKey(7, 42))
  })
})
