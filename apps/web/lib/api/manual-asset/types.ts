/**
 * The kinds a person picks when adding or editing an asset. A crypto wallet is
 * created through its own form and its kind never changes, so it is not here.
 */
export const MANUAL_ASSET_KINDS = [
  "property",
  "vehicle",
  "valuable",
  "other",
] as const;

export type EditableManualAssetKind = (typeof MANUAL_ASSET_KINDS)[number];

export type ManualAssetKind = EditableManualAssetKind | "crypto_wallet";

export const CRYPTO_CHAINS = ["bitcoin", "ethereum"] as const;

export type CryptoChain = (typeof CRYPTO_CHAINS)[number];

export interface CryptoWalletTokenDto {
  cryptoWalletTokenKey: number;
  native: boolean;
  /** The ERC-20 contract; null for the chain's own coin. */
  contractAddress: string | null;
  symbol: string;
  name: string | null;
  /** A decimal string, exact (e.g. "0.01234567"). */
  quantity: string;
  /** Only ticked tokens count in the wallet's value. */
  tracked: boolean;
  /** Ticked, with a balance, but no price at the last sync. */
  priceMissing: boolean;
}

export type CryptoWalletAddressErrorCode =
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "rejected"
  | "invalid_response"
  | "disabled";

export interface CryptoWalletAddressDto {
  cryptoWalletAddressKey: number;
  chain: CryptoChain;
  /** A single address, or a Bitcoin extended public key (xpub, ypub, zpub). */
  kind: "address" | "xpub";
  /** Normalised: bech32 lower-case, Ethereum EIP-55 checksummed. */
  address: string;
  label: string | null;
  status: "pending" | "ok" | "failed";
  /** Why the last attempt failed; null unless `status` is `failed`. */
  errorCode: CryptoWalletAddressErrorCode | null;
  lastAttemptAt: string | null;
  /** The last successful read; the balances are as of then. */
  lastSyncedAt: string | null;
  /** The native coin first, then by symbol. */
  tokens: CryptoWalletTokenDto[];
}

export interface CryptoWalletDto {
  addresses: CryptoWalletAddressDto[];
  /** The latest successful sync of any address; null before the first. */
  lastSyncedAt: string | null;
  /** Ticked tokens with a balance but no price at the last sync: today's value was not updated. */
  unpricedSymbols: string[];
}

export interface ManualAssetValuation {
  manualAssetValuationKey: number;
  /** A calendar day, `YYYY-MM-DD`. */
  date: string;
  value: number;
  note: string | null;
}

export interface ManualAssetGrowthRule {
  /** Percent a year; negative depreciates. */
  annualRatePercent: number;
  startDate: string | null;
}

/** A loan secured against an asset: only the viewer's own loans are listed. */
export interface ManualAssetLinkedLoan {
  loanKey: number;
  name: string;
  /** The loan's currency, which `outstandingPrincipal` is in. */
  currency: string;
  /** Today's balance, after repayments and lender adjustments. */
  outstandingPrincipal: number;
  /** `outstandingPrincipal` in the asset's currency. Null when there is no exchange rate. */
  outstandingPrincipalInAssetCurrency: number | null;
}

export interface ManualAsset {
  manualAssetKey: number;
  name: string;
  kind: ManualAssetKind;
  notes: string | null;
  /** The currency the asset is valued in. */
  currency: string;
  currencyKey: number;
  isPrivate: boolean;
  /** Only the owner may change `isPrivate`. */
  isOwner: boolean;
  ownerAppuserKey: number;
  ownerFirstName: string | null;
  archived: boolean;
  archivedAt: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  growthRule: ManualAssetGrowthRule | null;
  /** Today's value in `currency`. Null for an archived asset. */
  value: number | null;
  /** `value` in `userCurrency`. Null when there is no value or no exchange rate. */
  valueInUserCurrency: number | null;
  userCurrency: string;
  /** The latest valuation recorded, before any growth rule. */
  lastValuation: ManualAssetValuation | null;
  /** The viewer's loans secured against this asset. */
  linkedLoans: ManualAssetLinkedLoan[];
  /**
   * The linked loans' outstanding principal in `currency`: 0 with none, null when a loan's
   * currency has no exchange rate to it (see `unconvertedLoanCurrencies`).
   */
  linkedDebt: number | null;
  /** `value` less `linkedDebt`; negative when underwater. Null when either is null. */
  equity: number | null;
  /** The linked loans' currencies with no rate to `currency`, sorted. */
  unconvertedLoanCurrencies: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ManualAssetsSummary {
  currencyCode: string;
  /** False when an asset was left out of `totalValue` because no rate converts it. */
  isComplete: boolean;
  totalValue: number;
  unconvertedAssets: number;
  unconvertedCurrencies: string[];
}

export interface GetManualAssetsResponse {
  assets: ManualAsset[];
  summary: ManualAssetsSummary;
}

export interface GetManualAssetResponse {
  asset: ManualAsset;
  /** Newest first. */
  valuations: ManualAssetValuation[];
  /** The points of the value chart, oldest first, in the asset's currency. */
  history: Array<{ date: string; value: number }>;
  /** The wallet's addresses and balances; null for any other kind of asset. */
  wallet: CryptoWalletDto | null;
}

export interface GrowthRuleRequest {
  annualRatePercent: number;
  startDate?: string | null;
}

export interface CreateManualAssetRequest {
  name: string;
  kind: EditableManualAssetKind;
  currencyKey: number;
  value: number;
  valuationDate?: string;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  isPrivate?: boolean;
  notes?: string | null;
  growthRule?: GrowthRuleRequest | null;
}

export interface UpdateManualAssetRequest {
  name?: string;
  kind?: EditableManualAssetKind;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  isPrivate?: boolean;
  notes?: string | null;
  growthRule?: GrowthRuleRequest | null;
  archived?: boolean;
}

export interface SaveValuationRequest {
  value: number;
  date?: string;
  note?: string | null;
}

export interface CryptoWalletAddressRequest {
  chain: CryptoChain;
  /** A public address, or an xpub/ypub/zpub for Bitcoin. Never a private key or a recovery phrase. */
  address: string;
  label?: string | null;
}

export interface CreateCryptoWalletRequest {
  name: string;
  isPrivate?: boolean;
  notes?: string | null;
  /** One to twenty. */
  addresses: CryptoWalletAddressRequest[];
}

export interface CreateCryptoWalletResponse {
  asset: ManualAsset;
  wallet: CryptoWalletDto;
}
