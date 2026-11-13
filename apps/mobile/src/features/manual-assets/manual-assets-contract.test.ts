import {
  createCryptoWalletAddAddressEndpoint,
  createCryptoWalletAddressLabelEndpoint,
  createCryptoWalletRemoveAddressEndpoint,
  createCryptoWalletSyncEndpoint,
  createCryptoWalletTokenEndpoint,
  cryptoWalletCreateWriteSchema,
} from './crypto-wallet-contract'
import {
  createManualAssetDeleteEndpoint,
  createManualAssetEndpoint,
  createManualAssetUpdateEndpoint,
  cryptoWalletCreateEndpoint,
  cryptoWalletUpdateWriteSchema,
  createManualAssetValuationEndpoint,
  manualAssetCreateWriteSchema,
  manualAssetResponseSchema,
  manualAssetsEndpoint,
  manualAssetsResponseSchema,
  parseManualAssetId,
} from './manual-assets-contract'
import { assetDetailFixture, assetFixture, assetsFixture, BTC_ADDRESS, walletDetailFixture, walletFixture } from './test-fixtures'

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

  it('reads a crypto wallet: its kind, addresses, statuses and tokens with exact quantities', () => {
    const parsed = manualAssetResponseSchema.parse(walletDetailFixture())
    expect(parsed.asset.kind).toBe('crypto_wallet')
    expect(parsed.wallet).toEqual(walletFixture)
    expect(parsed.wallet?.addresses[1]).toMatchObject({ status: 'failed', errorCode: 'timeout' })
    expect(parsed.wallet?.addresses[0].tokens[0].quantity).toBe('0.01234567')
    expect(manualAssetsResponseSchema.parse(assetsFixture([walletDetailFixture().asset])).assets[0].kind).toBe('crypto_wallet')
  })

  it('reads no wallet from an API that predates them, and a chain or failure it does not know without failing', () => {
    const { wallet: _wallet, ...older } = assetDetailFixture()
    expect(manualAssetResponseSchema.parse(older).wallet).toBeNull()
    const address = { ...walletFixture.addresses[1], chain: 'solana', errorCode: 'quota', kind: 'descriptor' }
    const parsed = manualAssetResponseSchema.parse({ ...walletDetailFixture(), wallet: { ...walletFixture, addresses: [address] } })
    expect(parsed.wallet?.addresses[0]).toMatchObject({ chain: 'unknown', errorCode: 'unknown', kind: 'address' })
  })

  it('pins the crypto wallet endpoints', () => {
    expect(cryptoWalletCreateEndpoint).toMatchObject({ method: 'POST', path: '/v1/manual-assets/crypto-wallets', successStatuses: [201] })
    expect(createCryptoWalletAddAddressEndpoint(21)).toMatchObject({ method: 'POST', path: '/v1/manual-assets/21/addresses', successStatuses: [201] })
    expect(createCryptoWalletAddressLabelEndpoint(21, 31)).toMatchObject({ method: 'PATCH', path: '/v1/manual-assets/21/addresses/31' })
    expect(createCryptoWalletRemoveAddressEndpoint(21, 31)).toMatchObject({ method: 'DELETE', path: '/v1/manual-assets/21/addresses/31' })
    expect(createCryptoWalletTokenEndpoint(21, 42)).toMatchObject({ method: 'PATCH', path: '/v1/manual-assets/21/tokens/42' })
    expect(createCryptoWalletSyncEndpoint(21)).toMatchObject({ method: 'POST', path: '/v1/manual-assets/21/sync', successStatuses: [202] })
    expect(() => createCryptoWalletTokenEndpoint(21, 0)).toThrow()
    expect(createManualAssetUpdateEndpoint(21)).toMatchObject({ method: 'PATCH', path: '/v1/manual-assets/21', successStatuses: [200] })
    expect(createManualAssetDeleteEndpoint(21)).toMatchObject({ method: 'DELETE', path: '/v1/manual-assets/21', successStatuses: [204] })
    // A wallet's edit sends only its name and privacy, never a kind or a value.
    expect(cryptoWalletUpdateWriteSchema.safeParse({ name: 'Ledger' }).success).toBe(true)
    expect(cryptoWalletUpdateWriteSchema.safeParse({ kind: 'property' }).success).toBe(false)
    expect(cryptoWalletUpdateWriteSchema.safeParse({}).success).toBe(false)
  })

  it('writes a wallet with one to twenty addresses on a known chain, and nothing else', () => {
    const base = { name: 'Cold storage', isPrivate: false, addresses: [{ chain: 'bitcoin' as const, address: BTC_ADDRESS }] }
    expect(cryptoWalletCreateWriteSchema.safeParse(base).success).toBe(true)
    expect(cryptoWalletCreateWriteSchema.safeParse({ ...base, addresses: [] }).success).toBe(false)
    expect(cryptoWalletCreateWriteSchema.safeParse({ ...base, addresses: Array.from({ length: 21 }, () => base.addresses[0]) }).success).toBe(false)
    expect(cryptoWalletCreateWriteSchema.safeParse({ ...base, addresses: [{ chain: 'solana', address: 'x' }] }).success).toBe(false)
    expect(cryptoWalletCreateWriteSchema.safeParse({ ...base, kind: 'crypto_wallet' }).success).toBe(false)
  })

  it.each([['7', 7], ['0', null], ['-1', null], ['7a', null], [['7'], null], [undefined, null]])('parses the route id %p as %p', (input, expected) => {
    expect(parseManualAssetId(input)).toBe(expected)
  })
})
