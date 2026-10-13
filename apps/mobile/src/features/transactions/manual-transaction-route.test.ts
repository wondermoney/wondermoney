import { resolveMerchantSearchStatus } from './manual-transaction-route'

describe('manual transaction route merchant search state', () => {
  it('exposes current loading, error, and conclusive loaded states with error precedence', () => {
    expect(resolveMerchantSearchStatus({ isError: false, isFetching: true })).toBe('loading')
    expect(resolveMerchantSearchStatus({ isError: true, isFetching: false })).toBe('error')
    expect(resolveMerchantSearchStatus({ isError: true, isFetching: true })).toBe('error')
    expect(resolveMerchantSearchStatus({ isError: false, isFetching: false })).toBe('loaded')
  })
})
