import type { CryptoWalletDto } from './crypto-wallet-contract'
import type { ManualAssetDto, ManualAssetResponse, ManualAssetsResponse } from './manual-assets-contract'

/** A shared home in euros, valued twice, owned by the viewer: as the API returns it. */
export const assetFixture: ManualAssetDto = {
  manualAssetKey: 7,
  name: 'Family home',
  kind: 'property',
  notes: null,
  currency: 'EUR',
  currencyKey: 1,
  isPrivate: false,
  isOwner: true,
  ownerFirstName: 'Ana',
  archived: false,
  archivedAt: null,
  purchaseDate: '2025-01-10',
  purchasePrice: 200_000,
  growthRule: null,
  value: 250_000,
  valueInUserCurrency: 250_000,
  userCurrency: 'EUR',
  lastValuation: { manualAssetValuationKey: 101, date: '2026-06-01', value: 250_000, note: 'Agent estimate' },
  linkedLoans: [],
  linkedDebt: 0,
  equity: 250_000,
  unconvertedLoanCurrencies: [],
}

export const assetsFixture = (assets: ManualAssetDto[] = [assetFixture], summary: Partial<ManualAssetsResponse['summary']> = {}): ManualAssetsResponse => ({
  assets,
  summary: { currencyCode: 'EUR', isComplete: true, totalValue: 250_000, unconvertedAssets: 0, unconvertedCurrencies: [], ...summary },
})

export const assetDetailFixture = (asset: Partial<ManualAssetDto> = {}): ManualAssetResponse => ({
  asset: { ...assetFixture, ...asset },
  valuations: [
    { manualAssetValuationKey: 101, date: '2026-06-01', value: 250_000, note: 'Agent estimate' },
    { manualAssetValuationKey: 100, date: '2025-01-10', value: 200_000, note: null },
  ],
  history: [
    { date: '2025-01-10', value: 200_000 },
    { date: '2026-06-01', value: 250_000 },
    { date: '2026-11-10', value: 250_000 },
  ],
  wallet: null,
})

// Synthetic public addresses only: never a real person's.
export const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
export const ETH_ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
// Synthetic wallet secrets, for the guard: a raw hex key and the BIP-39 test vector phrase.
// Any 64 hex digits have the shape of a private key; this one is nobody's.
export const HEX_PRIVATE_KEY = 'ab'.repeat(32)
export const SEED_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** A shared crypto wallet in USD: a Bitcoin address that synced, an Ethereum one whose last read timed out. */
export const walletAssetFixture: ManualAssetDto = {
  ...assetFixture,
  manualAssetKey: 21,
  name: 'Cold storage',
  kind: 'crypto_wallet',
  currency: 'USD',
  currencyKey: 2,
  purchaseDate: null,
  purchasePrice: null,
  value: 1_234.5,
  valueInUserCurrency: 1_100,
  lastValuation: { manualAssetValuationKey: 301, date: '2026-11-12', value: 1_234.5, note: null },
  equity: 1_234.5,
}

export const walletFixture: CryptoWalletDto = {
  lastSyncedAt: '2026-11-12T04:30:00.000Z',
  unpricedSymbols: ['WMT'],
  addresses: [
    {
      cryptoWalletAddressKey: 31,
      chain: 'bitcoin',
      kind: 'address',
      address: BTC_ADDRESS,
      label: 'Hardware',
      status: 'ok',
      errorCode: null,
      lastAttemptAt: '2026-11-12T04:30:00.000Z',
      lastSyncedAt: '2026-11-12T04:30:00.000Z',
      tokens: [
        { cryptoWalletTokenKey: 41, native: true, contractAddress: null, symbol: 'BTC', name: 'Bitcoin', quantity: '0.01234567', tracked: true, priceMissing: false },
      ],
    },
    {
      cryptoWalletAddressKey: 32,
      chain: 'ethereum',
      kind: 'address',
      address: ETH_ADDRESS,
      label: null,
      status: 'failed',
      errorCode: 'timeout',
      lastAttemptAt: '2026-11-12T04:31:00.000Z',
      lastSyncedAt: '2026-11-11T04:30:00.000Z',
      tokens: [
        { cryptoWalletTokenKey: 42, native: true, contractAddress: null, symbol: 'ETH', name: 'Ether', quantity: '1250.5', tracked: true, priceMissing: false },
        { cryptoWalletTokenKey: 43, native: false, contractAddress: '0x1111111111111111111111111111111111111111', symbol: 'WMT', name: 'Wonder Test Token', quantity: '10', tracked: true, priceMissing: true },
        { cryptoWalletTokenKey: 44, native: false, contractAddress: '0x2222222222222222222222222222222222222222', symbol: 'XYZ', name: null, quantity: '3', tracked: false, priceMissing: false },
      ],
    },
  ],
}

export const walletDetailFixture = (wallet: Partial<CryptoWalletDto> = {}, asset: Partial<ManualAssetDto> = {}): ManualAssetResponse => ({
  asset: { ...walletAssetFixture, ...asset },
  valuations: [{ manualAssetValuationKey: 301, date: '2026-11-12', value: 1_234.5, note: null }],
  history: [
    { date: '2026-11-11', value: 1_200 },
    { date: '2026-11-12', value: 1_234.5 },
  ],
  wallet: { ...walletFixture, ...wallet },
})
