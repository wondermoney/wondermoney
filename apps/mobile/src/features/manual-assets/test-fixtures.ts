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
})
