import {
  createManualAssetEndpoint,
  createManualAssetValuationEndpoint,
  manualAssetCreateWriteSchema,
  manualAssetResponseSchema,
  manualAssetsEndpoint,
  manualAssetsResponseSchema,
  parseManualAssetId,
} from './manual-assets-contract'
import { assetDetailFixture, assetFixture, assetsFixture } from './test-fixtures'

describe('manual assets contract', () => {
  it('pins the list and detail fixtures and endpoints', () => {
    expect(manualAssetsEndpoint).toMatchObject({ method: 'GET', path: '/v1/manual-assets' })
    expect(createManualAssetEndpoint(7)).toMatchObject({ method: 'GET', path: '/v1/manual-assets/7' })
    expect(manualAssetsResponseSchema.parse(assetsFixture())).toEqual(assetsFixture())
    expect(manualAssetResponseSchema.parse(assetDetailFixture())).toEqual(assetDetailFixture())
  })

  it('strips fields it does not use and reads a kind it does not know as other', () => {
    const parsed = manualAssetsResponseSchema.parse(assetsFixture([{ ...assetFixture, kind: 'boat' as never, createdAt: 'x', ownerAppuserKey: 3 } as never]))
    expect(parsed.assets[0].kind).toBe('other')
    expect(parsed.assets[0]).not.toHaveProperty('createdAt')
  })

  it('keeps a missing exchange rate as null, never a number', () => {
    const parsed = manualAssetsResponseSchema.parse(assetsFixture([{ ...assetFixture, currency: 'NGN', valueInUserCurrency: null }], { isComplete: false, unconvertedAssets: 1, unconvertedCurrencies: ['NGN'] }))
    expect(parsed.assets[0].valueInUserCurrency).toBeNull()
    expect(parsed.summary.isComplete).toBe(false)
  })

  it('reads the equity of an asset with loans secured against it, keeping a missing rate as null', () => {
    const linkedLoans = [
      { loanKey: 3, name: 'Mortgage', currency: 'EUR', outstandingPrincipal: 150_000, outstandingPrincipalInAssetCurrency: 150_000 },
      { loanKey: 5, name: 'Naira loan', currency: 'NGN', outstandingPrincipal: 9_000_000, outstandingPrincipalInAssetCurrency: null },
    ]
    const parsed = manualAssetResponseSchema.parse(assetDetailFixture({ linkedLoans, linkedDebt: null, equity: null, unconvertedLoanCurrencies: ['NGN'] }))
    expect(parsed.asset).toMatchObject({ linkedLoans, linkedDebt: null, equity: null, unconvertedLoanCurrencies: ['NGN'] })
    expect(manualAssetsResponseSchema.safeParse(assetsFixture([{ ...assetFixture, linkedLoans: [{ ...linkedLoans[0], currency: 'euro' }] }])).success).toBe(false)
  })

  it('reads an asset from an API that predates equity as one with no loans against it', () => {
    const { linkedLoans: _loans, linkedDebt: _debt, equity: _equity, unconvertedLoanCurrencies: _codes, ...older } = assetFixture
    const parsed = manualAssetsResponseSchema.parse({ ...assetsFixture(), assets: [older] })
    expect(parsed.assets[0]).toMatchObject({ linkedLoans: [], linkedDebt: null, equity: null, unconvertedLoanCurrencies: [] })
    expect(manualAssetResponseSchema.parse({ ...assetDetailFixture(), asset: older }).asset.linkedLoans).toEqual([])
  })

  it('accepts a valuation that replaced the same day (200) as well as a new one (201)', () => {
    expect(createManualAssetValuationEndpoint(7)).toMatchObject({ method: 'POST', path: '/v1/manual-assets/7/valuations', successStatuses: [200, 201] })
  })

  it('writes only the fields the API takes, and no negative value', () => {
    const base = { name: 'Car', kind: 'vehicle' as const, currencyKey: 1, value: 18_000, valuationDate: '2026-11-10', isPrivate: false }
    expect(manualAssetCreateWriteSchema.safeParse(base).success).toBe(true)
    expect(manualAssetCreateWriteSchema.safeParse({ ...base, value: -1 }).success).toBe(false)
    expect(manualAssetCreateWriteSchema.safeParse({ ...base, ownerAppuserKey: 3 }).success).toBe(false)
    expect(manualAssetCreateWriteSchema.safeParse({ ...base, growthRule: { annualRatePercent: -100 } }).success).toBe(false)
  })

  it.each([['7', 7], ['0', null], ['-1', null], ['7a', null], [['7'], null], [undefined, null]])('parses the route id %p as %p', (input, expected) => {
    expect(parseManualAssetId(input)).toBe(expected)
  })
})
