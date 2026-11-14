import { buildCryptoWalletAddressPayload, buildCryptoWalletCreatePayload, formatTokenQuantity, shortAddress, walletSecretIndexes } from './crypto-wallet-forms-model'
import { BTC_ADDRESS, ETH_ADDRESS, HEX_PRIVATE_KEY, SEED_PHRASE } from './test-fixtures'

describe('crypto wallet forms', () => {
  it('finds the addresses that look like a private key or a recovery phrase, and only those', () => {
    expect(walletSecretIndexes([{ address: BTC_ADDRESS }, { address: HEX_PRIVATE_KEY }, { address: ETH_ADDRESS }, { address: ` ${SEED_PHRASE} ` }])).toEqual([1, 3])
    expect(walletSecretIndexes([{ address: `0x${HEX_PRIVATE_KEY}` }])).toEqual([0])
    expect(walletSecretIndexes([{ address: BTC_ADDRESS }, { address: '' }])).toEqual([])
  })

  it('builds the contract body, trimming and leaving empty optional fields out', () => {
    const result = buildCryptoWalletCreatePayload({
      name: ' Cold storage ', isPrivate: true, notes: ' ',
      addresses: [{ chain: 'bitcoin', address: ` ${BTC_ADDRESS} `, label: ' Hardware ' }, { chain: 'ethereum', address: ETH_ADDRESS, label: '' }],
    })
    expect(result).toEqual({ success: true, payload: {
      name: 'Cold storage', isPrivate: true,
      addresses: [{ chain: 'bitcoin', address: BTC_ADDRESS, label: 'Hardware' }, { chain: 'ethereum', address: ETH_ADDRESS }],
    } })
  })

  it('names each wrong field, per address', () => {
    const result = buildCryptoWalletCreatePayload({ name: '', isPrivate: false, notes: '', addresses: [{ chain: 'bitcoin', address: BTC_ADDRESS, label: '' }, { chain: null, address: '', label: '' }] })
    expect(result.success).toBe(false)
    if (!result.success) expect([...result.invalidFields].sort()).toEqual(['addresses.1.address', 'addresses.1.chain', 'name'])
    expect(buildCryptoWalletAddressPayload({ chain: 'ethereum', address: ETH_ADDRESS, label: '' })).toEqual({ success: true, payload: { chain: 'ethereum', address: ETH_ADDRESS } })
  })

  it('shortens an address and keeps every digit of a quantity in the reader’s language', () => {
    expect(shortAddress(BTC_ADDRESS)).toBe('bc1qar0s…5mdq')
    expect(formatTokenQuantity('1250.01234567', 'en')).toBe('1,250.01234567')
    expect(formatTokenQuantity('1250.5', 'es')).toMatch(/^1\.?250,5$/)
    expect(formatTokenQuantity('0.000000000000000001', 'en')).toBe('0.000000000000000001')
    expect(formatTokenQuantity('1e-8', 'en')).toBe('1e-8')
  })
})
