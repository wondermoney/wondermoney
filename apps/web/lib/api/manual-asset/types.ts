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
