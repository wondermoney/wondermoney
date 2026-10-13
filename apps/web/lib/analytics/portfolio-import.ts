export const PORTFOLIO_IMPORT_FUNNEL_EVENTS = {
  sessionStarted: "portfolio_import_session_started",
  uploadSucceeded: "portfolio_import_upload_succeeded",
  uploadFailed: "portfolio_import_upload_failed",
  parseSucceeded: "portfolio_import_parse_succeeded",
  parseFailed: "portfolio_import_parse_failed",
  mappingSuggestionRequested: "portfolio_import_mapping_suggestion_requested",
  mappingSaved: "portfolio_import_mapping_saved",
  assetReviewSaved: "portfolio_import_asset_review_saved",
  confirmClicked: "portfolio_import_confirm_clicked",
  confirmSucceeded: "portfolio_import_confirm_succeeded",
  confirmFailed: "portfolio_import_confirm_failed",
} as const;

export type PortfolioImportFunnelEventName =
  (typeof PORTFOLIO_IMPORT_FUNNEL_EVENTS)[keyof typeof PORTFOLIO_IMPORT_FUNNEL_EVENTS];

export type PortfolioImportAnalyticsValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | PortfolioImportAnalyticsValue[]
  | { [key: string]: PortfolioImportAnalyticsValue };

export type PortfolioImportAnalyticsProperties = Record<string, PortfolioImportAnalyticsValue>;

interface PortfolioImportAnalyticsClient {
  capture: (eventName: string, properties?: Record<string, unknown>) => void;
}

const SENSITIVE_PROPERTY_PARTS = [
  "filename",
  "file_name",
  "filepath",
  "s3",
  "bucket",
  "asset",
  "ticker",
  "isin",
  "account",
  "broker",
  "raw",
  "csv",
  "rawrow",
  "rawrows",
  "rowvalues",
];

function isSensitivePropertyKey(key: string) {
  const normalized = key.toLowerCase();
  return SENSITIVE_PROPERTY_PARTS.some((part) => normalized.includes(part));
}

function sanitizePortfolioImportAnalyticsValue(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePortfolioImportAnalyticsValue(item));
  }
  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, entryValue]) => entryValue !== undefined && !isSensitivePropertyKey(key))
      .map(([key, entryValue]) => [key, sanitizePortfolioImportAnalyticsValue(entryValue)]),
  );
}

export function sanitizePortfolioImportAnalyticsProperties(
  properties: PortfolioImportAnalyticsProperties = {},
) {
  return sanitizePortfolioImportAnalyticsValue(properties) as Record<
    string,
    string | number | boolean | null
  >;
}

export function capturePortfolioImportFunnelEvent(
  client: PortfolioImportAnalyticsClient | null | undefined,
  eventName: PortfolioImportFunnelEventName,
  properties?: PortfolioImportAnalyticsProperties,
) {
  client?.capture(eventName, sanitizePortfolioImportAnalyticsProperties(properties));
}
