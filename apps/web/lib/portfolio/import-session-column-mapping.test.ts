import assert from "node:assert/strict";

import { test } from "vitest";

import {
  extractPortfolioImportCsvColumns,
  getPortfolioImportAvailableColumns,
  getPortfolioImportColumnFieldsNeedingAttention,
  validatePortfolioImportColumnMapping,
} from "./import-session-column-mapping";

test("extracts csv header columns from a quoted line", () => {
  assert.deepEqual(
    extractPortfolioImportCsvColumns('"Transaction Date","Ticker","Asset, Name","External ID"\n2026-01-01,ABC,Example,1'),
    ["Transaction Date", "Ticker", "Asset, Name", "External ID"],
  );
});

test("merges local csv, preview, and suggestion columns without duplicates", () => {
  assert.deepEqual(
    getPortfolioImportAvailableColumns({
      localCsvColumns: ["Date", "Ticker", "Local Only "],
      preview: {
        assetGroups: [],
        importSessionId: 1,
        limits: { rowsPerBucket: 25 },
        portfolioId: 1,
        rows: {
          duplicate: [],
          invalid: [
            {
              id: 1,
              raw: { Date: "2026-01-01", Amount: "10" },
              rowNumber: 1,
              status: "invalid",
            },
          ],
          needsAssetReview: [],
          ready: [],
        },
        status: "needs_column_mapping",
        summary: {
          duplicateRows: 0,
          invalidRows: 1,
          needsAssetReviewRows: 0,
          readyRows: 0,
          skippedRows: 0,
          totalRows: 1,
        },
        columnMapping: {
          suggestion: {
            confidence: 0.9,
            columnMapping: { currency: "CCY", transactionDate: "Date" },
            transformations: {},
            warnings: [],
          },
        },
      },
    }),
    ["Date", "Ticker", "Local Only", "Amount", "CCY"],
  );
});

test("validates grouped portfolio import mapping requirements", () => {
  const missing = validatePortfolioImportColumnMapping({
    columnMapping: { currency: "Currency" },
    transformations: {},
  });

  assert.equal(missing.isValid, false);
  assert.deepEqual(missing.missingIssues.map((issue) => issue.key), [
    "transactionDate",
    "quantity",
    "unitPriceOrTotalAmount",
    "transactionTypeOrDirectionRule",
    "assetIdentity",
  ]);

  assert.equal(
    validatePortfolioImportColumnMapping({
      columnMapping: {
        assetName: "Asset",
        currency: "Currency",
        quantity: "Quantity",
        transactionDate: "Date",
        totalAmount: "Total",
      },
      transformations: { negativeAmountMeansBuy: true },
    }).isValid,
    true,
  );

  assert.equal(
    validatePortfolioImportColumnMapping({
      columnMapping: {
        assetName: "Asset",
        quantity: "Quantity",
        totalAmount: "Total",
        transactionDate: "Date",
      },
      fixedValues: { currency: "EUR" },
      derivedValues: { transactionType: "quantitySign" },
    }).isValid,
    true,
  );
});

test("field classification: fully mapped fields need no attention", () => {
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: {
      transactionDate: "Date",
      quantity: "Quantity",
      currency: "Currency",
      transactionType: "Type",
      totalAmount: "Total",
      ticker: "Ticker",
      brokerExchange: "Exchange",
      feeAmount: "Fee",
      externalTransactionId: "External ID",
    },
    fieldKeys: [
      "transactionDate",
      "quantity",
      "currency",
      "transactionType",
      "unitPrice",
      "totalAmount",
      "isin",
      "ticker",
      "assetName",
      "brokerExchange",
      "feeAmount",
      "externalTransactionId",
    ],
  });

  assert.deepEqual([...needsAttention], []);
});

test("field classification: unmapped required singleton needs attention", () => {
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: {
      quantity: "Quantity",
      currency: "Currency",
      transactionType: "Type",
      totalAmount: "Total",
      ticker: "Ticker",
    },
    fieldKeys: ["transactionDate", "quantity", "currency", "transactionType", "totalAmount", "ticker"],
  });

  assert.deepEqual([...needsAttention], ["transactionDate"]);
});

test("field classification: OR-group satisfied by one sibling clears both", () => {
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: {
      transactionDate: "Date",
      quantity: "Quantity",
      currency: "Currency",
      transactionType: "Type",
      totalAmount: "Total",
      ticker: "Ticker",
    },
    fieldKeys: ["transactionDate", "quantity", "currency", "transactionType", "unitPrice", "totalAmount", "isin", "ticker", "assetName"],
  });

  assert.equal(needsAttention.has("unitPrice"), false);
  assert.equal(needsAttention.has("totalAmount"), false);
  assert.equal(needsAttention.has("isin"), false);
  assert.equal(needsAttention.has("assetName"), false);
});

test("field classification: OR-group unsatisfied flags every member", () => {
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: {
      transactionDate: "Date",
      quantity: "Quantity",
      currency: "Currency",
      transactionType: "Type",
    },
    fieldKeys: ["unitPrice", "totalAmount", "isin", "ticker", "assetName"],
  });

  assert.deepEqual([...needsAttention].sort(), ["assetName", "isin", "ticker", "totalAmount", "unitPrice"]);
});

test("field classification: transactionType satisfied by a transformation flag", () => {
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: {},
    fieldKeys: ["transactionType"],
    transformations: { negativeAmountMeansBuy: true },
  });

  assert.deepEqual([...needsAttention], []);
});

test("field classification: currency satisfied by a fixed value", () => {
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: {},
    fieldKeys: ["currency"],
    fixedValues: { currency: "EUR" },
  });

  assert.deepEqual([...needsAttention], []);
});

test("field classification: unmapped standalone optional fields need attention", () => {
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: { feeAmount: "Fee" },
    fieldKeys: ["brokerExchange", "feeAmount", "externalTransactionId"],
  });

  assert.deepEqual([...needsAttention], ["brokerExchange", "externalTransactionId"]);
});

test("field classification: a blank mapping leaves no fields eligible to collapse", () => {
  const fieldKeys = [
    "transactionDate",
    "quantity",
    "currency",
    "transactionType",
    "unitPrice",
    "totalAmount",
    "isin",
    "ticker",
    "assetName",
    "brokerExchange",
    "feeAmount",
    "externalTransactionId",
  ] as const;
  const needsAttention = getPortfolioImportColumnFieldsNeedingAttention({
    columnMapping: {},
    fieldKeys: [...fieldKeys],
  });

  assert.deepEqual([...needsAttention], [...fieldKeys]);
});
