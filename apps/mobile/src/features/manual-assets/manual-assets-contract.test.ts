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
