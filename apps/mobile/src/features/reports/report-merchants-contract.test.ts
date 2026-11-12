import { transactionMerchantsEndpoint, transactionMerchantsResponseSchema } from './report-merchants-contract'

describe('report merchants contract', () => {
  it('pins the endpoint and parses the current API fixture', () => {
    expect(transactionMerchantsEndpoint).toMatchObject({ method: 'GET', path: '/v1/account/transaction-merchants' })
    const fixture = { transactionMerchants: [{ transactionMerchantKey: 1, name: 'Amazon' }] }
    expect(transactionMerchantsResponseSchema.parse(fixture)).toEqual(fixture)
  })

  it('reads the logo fields when the API sends them', () => {
    const merchant = { transactionMerchantKey: 1, name: 'Amazon', website: 'https://amazon.example', logoUrl: 'https://logos.example.org/amazon.png', resolvedLogoUrl: 'https://logos.example.org/amazon.png' }
    expect(transactionMerchantsResponseSchema.parse({ transactionMerchants: [merchant] })).toEqual({ transactionMerchants: [merchant] })
  })

  it('strips fields the API adds', () => {
    expect(transactionMerchantsResponseSchema.parse({ transactionMerchants: [{ transactionMerchantKey: 1, name: 'Amazon', logo: null }], total: 1 })).toEqual({ transactionMerchants: [{ transactionMerchantKey: 1, name: 'Amazon' }] })
  })

  it('rejects a merchant missing required fields', () => {
    expect(transactionMerchantsResponseSchema.safeParse({ transactionMerchants: [{ name: 'Amazon' }] }).success).toBe(false)
  })
})
