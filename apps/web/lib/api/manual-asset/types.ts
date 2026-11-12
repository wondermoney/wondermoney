export const MANUAL_ASSET_KINDS = [
  "property",
  "vehicle",
  "valuable",
  "other",
] as const;

export type ManualAssetKind = (typeof MANUAL_ASSET_KINDS)[number];

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
}

export interface GrowthRuleRequest {
  annualRatePercent: number;
  startDate?: string | null;
}

export interface CreateManualAssetRequest {
  name: string;
  kind: ManualAssetKind;
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
  kind?: ManualAssetKind;
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
