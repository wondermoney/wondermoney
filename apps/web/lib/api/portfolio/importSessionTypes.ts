export type PortfolioImportSessionStatus =
  | "waiting_for_upload"
  | "uploaded"
  | "parsing"
  | "needs_column_mapping"
  | "needs_asset_review"
  | "ready_to_import"
  | "importing"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "expired";

export const PORTFOLIO_IMPORT_DEFAULT_MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

export interface PortfolioImportSessionCreateResponse {
  correlationId: string;
  importSessionId: number;
  s3Bucket: string;
  s3Key: string;
  status: PortfolioImportSessionStatus;
  uploadUrl: string;
  uploadMethod?: "PUT" | "POST";
  uploadFields?: Record<string, string>;
  uploadHeaders?: Record<string, string>;
  maxUploadSizeBytes?: number;
  expiresAt?: string;
  broker?: { id: number; name: string };
}

export const PORTFOLIO_IMPORT_SUPPORTED_CURRENCIES = [
  "EUR",
  "USD",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "BRL",
  "DKK",
] as const;

export type PortfolioImportSupportedCurrencyCode =
  (typeof PORTFOLIO_IMPORT_SUPPORTED_CURRENCIES)[number];

export type PortfolioImportTransactionType = "BUY" | "SELL";

export type PortfolioImportTransactionTypeDerivation =
  | "quantitySign"
  | "totalAmountSign";

export interface PortfolioImportColumnMappingFixedValues {
  currency?: PortfolioImportSupportedCurrencyCode;
  transactionType?: PortfolioImportTransactionType;
}

export interface PortfolioImportColumnMappingDerivedValues {
  transactionType?: PortfolioImportTransactionTypeDerivation;
}

export interface PortfolioColumnMapping {
  assetName?: string;
  brokerExchange?: string;
  currency?: string;
  externalTransactionId?: string;
  feeAmount?: string;
  isin?: string;
  quantity?: string;
  ticker?: string;
  totalAmount?: string;
  transactionDate?: string;
  transactionType?: string;
  unitPrice?: string;
}

export interface PortfolioColumnMappingTransformations {
  dateFormat?: string;
  decimalSeparator?: "." | ",";
  negativeAmountMeansBuy?: boolean;
  quantitySignIndicatesDirection?: boolean;
  thousandsSeparator?: "." | "," | " " | "none";
}

export interface PortfolioCsvLayout {
  headerRowIndex: number;
  dataStartRowIndex: number;
  footerRowCount?: number;
  footerMatchers?: string[];
}

export interface PortfolioDetectedBrokerPreview {
  id?: number;
  name?: string;
  confidence?: number;
  match?: string;
}

export interface PortfolioColumnMappingSuggestion {
  columnMapping?: PortfolioColumnMapping;
  derivedValues?: PortfolioImportColumnMappingDerivedValues;
  layout?: PortfolioCsvLayout;
  fixedValues?: PortfolioImportColumnMappingFixedValues;
  transformations?: PortfolioColumnMappingTransformations;
  confidence?: number;
  detectedBroker?: PortfolioDetectedBrokerPreview;
  mappingSource?: "saved_spec" | "local_heuristic" | "llm" | "disabled";
  warning?: string;
  warnings?: string[];
  confirmedAt?: unknown;
}

export interface PortfolioImportColumnMappingPreview {
  confirmed?: PortfolioColumnMappingSuggestion;
  suggestion?: PortfolioColumnMappingSuggestion;
  layout?: PortfolioCsvLayout;
  warning?: string;
}

export interface PortfolioImportSessionParseResponse {
  correlationId: string;
  importSessionId: number;
  status: "parsing";
}

export interface PortfolioImportSessionSuggestColumnMappingResponse {
  columnMapping?: PortfolioColumnMappingSuggestion;
  importSessionId: number;
  status: PortfolioImportSessionStatus;
  mappingSource?: "saved_spec" | "local_heuristic" | "llm" | "disabled";
  warning?: string;
}

export interface PortfolioImportSessionConfirmColumnMappingResponse {
  importSessionId: number;
  status: PortfolioImportSessionStatus;
  summary: Record<string, unknown>;
}

export interface PortfolioImportSessionConfirmAssetMappingsResponse {
  importSessionId: number;
  status: PortfolioImportSessionStatus;
  summary: Record<string, unknown>;
}

export interface PortfolioImportSessionConfirmResponse {
  correlationId: string;
  importSessionId: number;
  status: "importing";
}

export type PortfolioImportRowStatus =
  | "valid"
  | "invalid"
  | "duplicate"
  | "needs_asset_review"
  | "ready"
  | "skipped"
  | "imported"
  | "failed";

export type PortfolioImportAssetGroupStatus =
  | "matched"
  | "ambiguous"
  | "unmatched"
  | "provider_error"
  | "selected"
  | "skipped";

export interface PortfolioImportCandidatePreview {
  confidence?: number;
  currency?: string;
  exchange?: string;
  hasPriceHistory: boolean;
  id: number;
  isin?: string;
  isRecommended?: boolean;
  name?: string;
  provider: string;
  rejectedReason?: string;
  symbol?: string;
}

export interface PortfolioImportAssetGroupPreview {
  candidates?: PortfolioImportCandidatePreview[];
  id: number;
  identity: {
    brokerAssetName?: string;
    brokerExchange?: string;
    brokerTicker?: string;
    currency?: string;
    isin?: string;
  };
  recommendedCandidateId?: number;
  recommendationReason?: string;
  resolutionReason?: string;
  selectedAction?: "use_candidate" | "use_existing_asset" | "skip_group";
  selectedFinancialAssetId?: number;
  status: PortfolioImportAssetGroupStatus;
}

export interface PortfolioImportPreviewRow {
  assetGroupId?: number;
  failureReason?: string;
  financialAssetId?: number;
  id: number;
  internalTransactionId?: string;
  normalized?: Record<string, unknown>;
  raw: Record<string, unknown>;
  rowNumber: number;
  skipReason?: string;
  status: PortfolioImportRowStatus;
}

export interface PortfolioImportSessionPreviewResponse {
  assetGroups: PortfolioImportAssetGroupPreview[];
  broker?: { id: number; name: string };
  columnMapping?: PortfolioImportColumnMappingPreview;
  importSessionId: number;
  limits: { rowsPerBucket: number };
  portfolioId: number;
  rows: {
    duplicate: PortfolioImportPreviewRow[];
    invalid: PortfolioImportPreviewRow[];
    needsAssetReview: PortfolioImportPreviewRow[];
    ready: PortfolioImportPreviewRow[];
  };
  status: PortfolioImportSessionStatus;
  summary: {
    assetGroups?: {
      ambiguousGroups: number;
      matchedGroups: number;
      selectedGroups?: number;
      skippedGroups?: number;
      providerErrorGroups: number;
      totalGroups: number;
      unmatchedGroups: number;
    };
    blockingRows?: number;
    duplicateRows: number;
    failureReason?: string;
    failedRows?: number;
    canConfirm?: boolean;
    importedRows?: number;
    invalidRows: number;
    needsAssetReviewRows: number;
    terminalKind?: "success" | "partial_success" | "duplicate_only" | "failed" | "expired" | "cancelled";
    unsupportedAssets?: Array<{ symbol: string; skippedRows: number }>;
    userSkippedRows?: number;
    readyRows: number;
    skippedRows: number;
    totalRows: number;
  };
}

export interface PortfolioImportSessionCreateRequest {
  portfolioId: string | number;
  brokerId?: string | number;
}

export interface PortfolioImportSessionParseRequest {
  importSessionId: string | number;
}

export interface PortfolioImportSessionPreviewRequest {
  importSessionId: string | number;
  limit?: number;
}

export interface PortfolioImportSessionSuggestColumnMappingRequest {
  importSessionId: string | number;
}

export interface PortfolioImportSessionConfirmColumnMappingRequest {
  importSessionId: string | number;
  columnMapping: PortfolioColumnMapping;
  derivedValues?: PortfolioImportColumnMappingDerivedValues;
  layout?: PortfolioCsvLayout;
  fixedValues?: PortfolioImportColumnMappingFixedValues;
  transformations?: PortfolioColumnMappingTransformations;
}

export type PortfolioImportAssetMappingDecision =
  | { action: "use_candidate"; groupId: number; candidateId: number }
  | { action: "use_external_symbol"; groupId: number; symbol: string }
  | { action: "use_existing_asset"; groupId: number; financialAssetId: number }
  | { action: "skip_group"; groupId: number; skipReason?: string };

export interface PortfolioImportSessionConfirmAssetMappingsRequest {
  importSessionId: string | number;
  decisions: PortfolioImportAssetMappingDecision[];
}

export interface PortfolioImportSessionConfirmRequest {
  importSessionId: string | number;
}
