import type {
  PortfolioColumnMapping,
  PortfolioColumnMappingTransformations,
  PortfolioCsvLayout,
  PortfolioImportColumnMappingDerivedValues,
  PortfolioImportColumnMappingFixedValues,
  PortfolioImportSessionPreviewResponse,
  PortfolioImportType,
} from "@/lib/api/portfolio/importSessionTypes";

export const PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE = "__not_mapped__";

export function normalizePortfolioImportColumnValue(value: string) {
  return value.trim();
}

export const PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS = {
  fixedCurrency: (currency: string) => `__fixed_currency:${currency}__`,
  fixedTransactionType: (transactionType: string) =>
    `__fixed_transaction_type:${transactionType}__`,
  derivedTransactionType: (strategy: string) =>
    `__derived_transaction_type:${strategy}__`,
} as const;

export function parsePortfolioImportColumnSourceToken(value: string):
  | { kind: "fixedCurrency"; currency: string }
  | { kind: "fixedTransactionType"; transactionType: string }
  | { kind: "derivedTransactionType"; strategy: string }
  | undefined {
  const fixedCurrency = value.match(/^__fixed_currency:([^_]+)__$/);
  if (fixedCurrency) return { kind: "fixedCurrency", currency: fixedCurrency[1] };

  const fixedTransactionType = value.match(/^__fixed_transaction_type:([^_]+)__$/);
  if (fixedTransactionType) {
    return {
      kind: "fixedTransactionType",
      transactionType: fixedTransactionType[1],
    };
  }

  const derivedTransactionType = value.match(/^__derived_transaction_type:([^_]+)__$/);
  if (derivedTransactionType) {
    return {
      kind: "derivedTransactionType",
      strategy: derivedTransactionType[1],
    };
  }

  return undefined;
}

export type PortfolioImportColumnMappingValidationIssueKey =
  | "asOfDate"
  | "transactionDate"
  | "quantity"
  | "currency"
  | "unitPriceOrTotalAmount"
  | "transactionTypeOrDirectionRule"
  | "assetIdentity";

export interface PortfolioImportColumnMappingValidationIssue {
  key: PortfolioImportColumnMappingValidationIssueKey;
  messageKey: string;
}

export function extractPortfolioImportCsvColumns(csvText: string) {
  const text = csvText.replace(/^\uFEFF/, "").trimStart();
  if (!text) return [] as string[];

  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];

    if (character === '"') {
      const nextCharacter = firstLine[index + 1];
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      const value = current.trim();
      if (value) columns.push(value);
      current = "";
      continue;
    }

    current += character;
  }

  const lastValue = current.trim();
  if (lastValue) columns.push(lastValue);

  return columns;
}

function addColumnValues(target: Set<string>, columns?: Iterable<string> | null) {
  if (!columns) return;

  for (const column of columns) {
    const value = normalizePortfolioImportColumnValue(column);
    if (value) target.add(value);
  }
}

function addMappingColumns(target: Set<string>, mapping?: PortfolioColumnMapping | null) {
  if (!mapping) return;

  addColumnValues(target, Object.values(mapping).filter((value): value is string => typeof value === "string"));
}

export function getPortfolioImportAvailableColumns(input: {
  localCsvColumns?: string[];
  preview?: PortfolioImportSessionPreviewResponse | null;
}) {
  const columns = new Set<string>();

  addColumnValues(columns, input.localCsvColumns);
  input.preview?.rows.duplicate.forEach((row) => addColumnValues(columns, Object.keys(row.raw)));
  input.preview?.rows.invalid.forEach((row) => addColumnValues(columns, Object.keys(row.raw)));
  input.preview?.rows.needsAssetReview.forEach((row) => addColumnValues(columns, Object.keys(row.raw)));
  input.preview?.rows.ready.forEach((row) => addColumnValues(columns, Object.keys(row.raw)));
  addMappingColumns(columns, input.preview?.columnMapping?.confirmed?.columnMapping);
  addMappingColumns(columns, input.preview?.columnMapping?.suggestion?.columnMapping);

  return Array.from(columns);
}

export function getPortfolioImportInitialColumnMapping(preview?: PortfolioImportSessionPreviewResponse | null) {
  return preview?.columnMapping?.confirmed?.columnMapping ?? preview?.columnMapping?.suggestion?.columnMapping;
}

export function getPortfolioImportInitialFixedValues(preview?: PortfolioImportSessionPreviewResponse | null) {
  return preview?.columnMapping?.confirmed?.fixedValues ?? preview?.columnMapping?.suggestion?.fixedValues;
}

export function getPortfolioImportInitialDerivedValues(preview?: PortfolioImportSessionPreviewResponse | null) {
  return preview?.columnMapping?.confirmed?.derivedValues ?? preview?.columnMapping?.suggestion?.derivedValues;
}

export function getPortfolioImportInitialTransformations(preview?: PortfolioImportSessionPreviewResponse | null) {
  return preview?.columnMapping?.confirmed?.transformations ?? preview?.columnMapping?.suggestion?.transformations;
}

export function getPortfolioImportInitialLayout(
  preview?: PortfolioImportSessionPreviewResponse | null,
): PortfolioCsvLayout {
  return (
    preview?.columnMapping?.confirmed?.layout ??
    preview?.columnMapping?.suggestion?.layout ??
    preview?.columnMapping?.layout ??
    { headerRowIndex: 0, dataStartRowIndex: 1 }
  );
}

interface PortfolioImportColumnMappingSatisfaction {
  hasAssetIdentity: boolean;
  hasCurrency: boolean;
  hasQuantity: boolean;
  hasTransactionDate: boolean;
  hasTypeOrDirectionRule: boolean;
  hasUnitPriceOrTotalAmount: boolean;
}

interface PortfolioImportColumnMappingInput {
  columnMapping: Partial<PortfolioColumnMapping>;
  fixedValues?: PortfolioImportColumnMappingFixedValues;
  derivedValues?: PortfolioImportColumnMappingDerivedValues;
  transformations?: PortfolioColumnMappingTransformations;
  /** Positions files need no transaction type, and their acquisition date is optional. */
  importType?: PortfolioImportType;
}

function getPortfolioImportColumnMappingSatisfaction(
  input: PortfolioImportColumnMappingInput,
): PortfolioImportColumnMappingSatisfaction {
  const positions = input.importType === "positions";
  return {
    hasAssetIdentity: Boolean(
      input.columnMapping.isin?.trim() ||
        input.columnMapping.ticker?.trim() ||
        input.columnMapping.assetName?.trim(),
    ),
    hasCurrency: Boolean(input.columnMapping.currency?.trim() || input.fixedValues?.currency),
    hasQuantity: Boolean(input.columnMapping.quantity?.trim()),
    hasTransactionDate:
      positions || Boolean(input.columnMapping.transactionDate?.trim()),
    hasTypeOrDirectionRule: Boolean(
      positions ||
        input.columnMapping.transactionType?.trim() ||
        input.fixedValues?.transactionType ||
        input.derivedValues?.transactionType ||
        input.transformations?.negativeAmountMeansBuy ||
        input.transformations?.quantitySignIndicatesDirection,
    ),
    hasUnitPriceOrTotalAmount: Boolean(
      input.columnMapping.unitPrice?.trim() || input.columnMapping.totalAmount?.trim(),
    ),
  };
}

export function validatePortfolioImportColumnMapping(
  input: PortfolioImportColumnMappingInput & {
    /** Positions files: the day rows without an acquisition date are bought on. */
    asOfDate?: string;
  },
) {
  const satisfaction = getPortfolioImportColumnMappingSatisfaction(input);
  const missingIssues: PortfolioImportColumnMappingValidationIssue[] = [];

  if (
    input.importType === "positions" &&
    !input.columnMapping.transactionDate?.trim() &&
    !input.asOfDate
  ) {
    missingIssues.push({
      key: "asOfDate",
      messageKey: "portfolio-import-column-validation-as-of-date",
    });
  }

  if (!satisfaction.hasTransactionDate) {
    missingIssues.push({
      key: "transactionDate",
      messageKey: "portfolio-import-column-validation-transaction-date",
    });
  }

  if (!satisfaction.hasQuantity) {
    missingIssues.push({
      key: "quantity",
      messageKey: "portfolio-import-column-validation-quantity",
    });
  }

  if (!satisfaction.hasCurrency) {
    missingIssues.push({
      key: "currency",
      messageKey: "portfolio-import-column-validation-currency",
    });
  }

  if (!satisfaction.hasUnitPriceOrTotalAmount) {
    missingIssues.push({
      key: "unitPriceOrTotalAmount",
      messageKey: "portfolio-import-column-validation-unit-price-or-total-amount",
    });
  }

  if (!satisfaction.hasTypeOrDirectionRule) {
    missingIssues.push({
      key: "transactionTypeOrDirectionRule",
      messageKey: "portfolio-import-column-validation-transaction-type-or-direction",
    });
  }

  if (!satisfaction.hasAssetIdentity) {
    missingIssues.push({
      key: "assetIdentity",
      messageKey: "portfolio-import-column-validation-asset-identity",
    });
  }

  return {
    isValid: missingIssues.length === 0,
    missingIssues,
  };
}

const PORTFOLIO_IMPORT_STANDALONE_OPTIONAL_COLUMN_FIELDS: (keyof PortfolioColumnMapping)[] = [
  "brokerExchange",
  "feeAmount",
  "externalTransactionId",
];

export function getPortfolioImportColumnFieldsNeedingAttention(
  input: PortfolioImportColumnMappingInput & {
    fieldKeys: (keyof PortfolioColumnMapping)[];
  },
): Set<keyof PortfolioColumnMapping> {
  const satisfaction = getPortfolioImportColumnMappingSatisfaction(input);
  const needsAttention = new Set<keyof PortfolioColumnMapping>();

  for (const fieldKey of input.fieldKeys) {
    if (PORTFOLIO_IMPORT_STANDALONE_OPTIONAL_COLUMN_FIELDS.includes(fieldKey)) {
      const value = input.columnMapping[fieldKey]?.trim();
      if (!value || value === PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE) {
        needsAttention.add(fieldKey);
      }
      continue;
    }

    if (fieldKey === "transactionDate" && !satisfaction.hasTransactionDate) {
      needsAttention.add(fieldKey);
    }
    if (fieldKey === "quantity" && !satisfaction.hasQuantity) {
      needsAttention.add(fieldKey);
    }
    if (fieldKey === "currency" && !satisfaction.hasCurrency) {
      needsAttention.add(fieldKey);
    }
    if (fieldKey === "transactionType" && !satisfaction.hasTypeOrDirectionRule) {
      needsAttention.add(fieldKey);
    }
    if (
      (fieldKey === "unitPrice" || fieldKey === "totalAmount") &&
      !satisfaction.hasUnitPriceOrTotalAmount
    ) {
      needsAttention.add(fieldKey);
    }
    if (
      (fieldKey === "isin" || fieldKey === "ticker" || fieldKey === "assetName") &&
      !satisfaction.hasAssetIdentity
    ) {
      needsAttention.add(fieldKey);
    }
  }

  return needsAttention;
}

/** The columns of the positions template, in order, and one example row. */
export const PORTFOLIO_POSITIONS_TEMPLATE_COLUMNS = [
  "Symbol",
  "ISIN",
  "Quantity",
  "Average cost",
  "Total cost",
  "Currency",
  "Acquisition date",
] as const;

/** A positions template: the header and one example row, which the person replaces. */
export function buildPortfolioPositionsTemplateCsv() {
  return [
    PORTFOLIO_POSITIONS_TEMPLATE_COLUMNS.join(","),
    "VWCE.XETRA,IE00BK5BQT80,12,98.50,,EUR,2023-04-17",
  ].join("\n");
}

/** The mapping a positions template produces, so a filled-in template needs no manual mapping. */
export function getPortfolioPositionsTemplateMapping(
  columns: string[],
): Partial<PortfolioColumnMapping> | undefined {
  const has = (column: string) => columns.includes(column);
  if (!PORTFOLIO_POSITIONS_TEMPLATE_COLUMNS.every(has)) return undefined;
  return {
    currency: "Currency",
    isin: "ISIN",
    quantity: "Quantity",
    ticker: "Symbol",
    totalAmount: "Total cost",
    transactionDate: "Acquisition date",
    unitPrice: "Average cost",
  };
}
