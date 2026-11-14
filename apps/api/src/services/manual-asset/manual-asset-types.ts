export enum ManualAssetKind {
  /** Valued from public addresses by the daily sync (`services/crypto-wallet/`), never by hand. */
  CRYPTO_WALLET = 'crypto_wallet',
  OTHER = 'other',
  PROPERTY = 'property',
  VALUABLE = 'valuable',
  VEHICLE = 'vehicle',
}
