import { transactionMerchantsEndpoint, transactionMerchantsResponseSchema } from './report-merchants-contract'

describe('report merchants contract', () => {
  it('pins the endpoint and parses the current API fixture', () => {
    expect(transactionMerchantsEndpoint).toMatchObject({ method: 'GET', path: '/v1/account/transaction-merchants' })
    const fixture = { transactionMerchants: [{ transactionMerchantKey: 1, name: 'Amazon' }] }
    expect(transactionMerchantsResponseSchema.parse(fixture)).toEqual(fixture)
  })

  it('rejects a merchant missing required fields', () => {
    expect(transactionMerchantsResponseSchema.safeParse({ transactionMerchants: [{ name: 'Amazon' }] }).success).toBe(false)
  })
})
