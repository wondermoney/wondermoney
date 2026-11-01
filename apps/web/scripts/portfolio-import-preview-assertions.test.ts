import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse as parseCsv } from "csv-parse/sync";

import { test } from "vitest";

import {
  assertRejectedTransactionInPreview,
  type ImportPreview,
  persistedUnsupportedAssetSymbols,
  unsupportedAssetsFromPreview,
} from "../cypress/e2e/portfolio-import/assertions";

const expectedOversell = {
  date: "20240124",
  quantity: -6,
  reason: /sell quantity exceeds available holdings/i,
  symbol: "AMD",
  transactionId: "TEST-TRANSACTIONID-007",
};

function publicPreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    rows: {
      duplicate: [],
      failed: [],
      invalid: [],
      needsAssetReview: [],
      ready: [],
    },
    summary: { failedRows: 0, needsAssetReviewRows: 0, totalRows: 77 },
    ...overrides,
  };
}

function originalIbkrOversellPreviewRow(): {
  failureReason: string;
  id: number;
  normalized: Record<string, unknown>;
  raw: Record<string, string>;
  rowNumber: number;
  status: string;
} {
  const base64 = readFileSync(
    new URL("../cypress/fixtures/portfolio-import/ibkr-flex-query.csv.base64", import.meta.url),
    "utf8",
  ).trim();
  const csv = Buffer.from(base64, "base64").toString("utf8");
  const rows = parseCsv<Record<string, string>>(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  });
  const source = rows.find(
    (row) => row.TransactionID === expectedOversell.transactionId,
  );
  if (!source) throw new Error("Original IBKR oversell fixture row is missing");

  // Public preview sanitization caps object entries at 50. TransactionID is
  // column 57 in this original export, so it is not present in rows.failed.raw.
  const raw = Object.fromEntries(Object.entries(source).slice(0, 50));
  const sourceDate = source.TradeDate;
  const normalized = {
    assetSymbol: source.Symbol,
    date: `${sourceDate.slice(0, 4)}-${sourceDate.slice(4, 6)}-${sourceDate.slice(6, 8)}T00:00:00.000Z`,
    externalTransactionId: source.TransactionID,
    quantity: Math.abs(Number(source.Quantity)),
    ticker: source.Symbol,
    transactionType: source["Buy/Sell"].toUpperCase(),
  };

  return {
    failureReason: "Sell quantity exceeds available holdings for AMD",
    id: 41,
    normalized,
    raw,
    rowNumber: rows.indexOf(source) + 1,
    status: "failed",
  };
}

test("unsupported FX identities come from the public preview summary", () => {
  const preview = {
    ...publicPreview({
      rows: {
        duplicate: [],
        failed: [],
        invalid: [],
        needsAssetReview: [],
        ready: [],
      },
      summary: {
        failedRows: 0,
        needsAssetReviewRows: 0,
        totalRows: 6,
        unsupportedAssets: [{ skippedRows: 1, symbol: "EUR.USD" }],
      },
    }),
    assetGroups: [
      { id: 1, identity: { brokerTicker: "EUR.USD" }, status: "unmatched" },
    ],
  };

  assert.deepEqual(unsupportedAssetsFromPreview(preview), [
    { skippedRows: 1, symbol: "EUR.USD" },
  ]);
});

test("an absent rows.failed bucket is a hard contract failure, not a summary fallback", () => {
  const oldPreviewShape = publicPreview({
    rows: {
      duplicate: [],
      invalid: [],
      needsAssetReview: [],
      ready: [
        {
          failureReason: "sell quantity exceeds available holdings",
          id: 7,
          normalized: {},
          raw: {
            Quantity: "-6",
            Symbol: "AMD",
            TradeDate: "20240124",
            TransactionID: "TEST-TRANSACTIONID-007",
          },
          rowNumber: 7,
          skipReason: undefined,
          status: "failed",
        },
      ],
    } as unknown as ImportPreview["rows"],
    summary: { failedRows: 1, needsAssetReviewRows: 0, totalRows: 77 },
  });

  assert.throws(
    () =>
      assertRejectedTransactionInPreview(oldPreviewShape, expectedOversell, 1),
    /preview contract is missing rows\.failed/,
  );
});

test("matches the original IBKR oversell from normalized identity when bounded raw omits TransactionID", () => {
  const failed = originalIbkrOversellPreviewRow();
  assert.equal(Object.keys(failed.raw).length, 50);
  assert.equal("TransactionID" in failed.raw, false);
  assert.deepEqual(
    {
      externalTransactionId: failed.normalized.externalTransactionId,
      ticker: failed.normalized.ticker,
      date: failed.normalized.date,
      quantity: failed.normalized.quantity,
      transactionType: failed.normalized.transactionType,
    },
    {
      externalTransactionId: expectedOversell.transactionId,
      ticker: expectedOversell.symbol,
      date: "2024-01-24T00:00:00.000Z",
      quantity: 6,
      transactionType: "SELL",
    },
  );
  const preview = publicPreview({
    rows: {
      duplicate: [],
      failed: [failed],
      invalid: [],
      needsAssetReview: [],
      ready: [],
    },
    summary: { failedRows: 1, needsAssetReviewRows: 0, totalRows: 77 },
  });

  assert.equal(
    assertRejectedTransactionInPreview(preview, expectedOversell, 1),
    failed,
  );
});

test("rejected transaction assertion matches source-row fields and its failure reason", () => {
  const rejected = {
    failureReason: "Sell quantity exceeds available holdings for AMD",
    id: 41,
    normalized: {
      assetSymbol: "AMD",
      date: "2024-01-24T00:00:00.000Z",
      externalTransactionId: expectedOversell.transactionId,
      quantity: 6,
      ticker: "AMD",
      transactionType: "SELL",
    },
    raw: {
      Quantity: "-6",
      Symbol: "AMD",
      TradeDate: "20240124",
      TransactionID: "TEST-TRANSACTIONID-007",
    },
    rowNumber: 41,
    skipReason: undefined,
    status: "failed",
  };
  const preview = publicPreview({
    rows: {
      duplicate: [],
      failed: [rejected],
      invalid: [],
      needsAssetReview: [],
      ready: [],
    },
    summary: { failedRows: 1, needsAssetReviewRows: 0, totalRows: 77 },
  });

  assert.equal(
    assertRejectedTransactionInPreview(preview, expectedOversell, 1),
    rejected,
  );
  assert.throws(
    () => assertRejectedTransactionInPreview(preview, expectedOversell, 0),
    /rows\.failed expected 0 rows, got 1/,
  );
});

test("rejects a different normalized identity, direction, status, reason, or conflicting raw identity", () => {
  const validRow = originalIbkrOversellPreviewRow();
  const previewWith = (row: typeof validRow) =>
    publicPreview({
      rows: {
        duplicate: [],
        failed: [row],
        invalid: [],
        needsAssetReview: [],
        ready: [],
      },
      summary: { failedRows: 1, needsAssetReviewRows: 0, totalRows: 77 },
    });
  const stillMissingExpectedRow = /rows\.failed is missing AMD transaction/;

  for (const normalized of [
    { ...validRow.normalized, externalTransactionId: "OTHER-TRANSACTION" },
    { ...validRow.normalized, date: "2024-01-25T00:00:00.000Z" },
    { ...validRow.normalized, quantity: 5 },
    { ...validRow.normalized, transactionType: "BUY" },
  ]) {
    assert.throws(
      () =>
        assertRejectedTransactionInPreview(
          previewWith({ ...validRow, normalized }),
          expectedOversell,
          1,
        ),
      stillMissingExpectedRow,
    );
  }

  assert.throws(
    () =>
      assertRejectedTransactionInPreview(
        previewWith({ ...validRow, raw: { ...validRow.raw, TransactionID: "OTHER-TRANSACTION" } }),
        expectedOversell,
        1,
      ),
    stillMissingExpectedRow,
  );
  assert.throws(
    () =>
      assertRejectedTransactionInPreview(
        previewWith({ ...validRow, status: "ready" }),
        expectedOversell,
        1,
      ),
    /has status ready, expected failed/,
  );
  assert.throws(
    () =>
      assertRejectedTransactionInPreview(
        previewWith({ ...validRow, failureReason: "another failure" }),
        expectedOversell,
        1,
      ),
    /failure reason did not match/,
  );
});

test("unsupported FX identities are never counted among persisted transactions", () => {
  assert.deepEqual(
    persistedUnsupportedAssetSymbols(
      [
        {
          financialAssetKey: { symbol: "SPYL" },
          quantity: 1,
          settlementCurrencyKey: { code: "EUR" },
        },
        {
          financialAssetKey: { symbol: "AMD" },
          quantity: 1,
          settlementCurrencyKey: { code: "EUR" },
        },
        {
          financialAssetKey: { symbol: "EUR.USD" },
          quantity: 1,
          settlementCurrencyKey: { code: "EUR" },
        },
      ],
      [{ symbol: "EUR.USD" }],
    ),
    ["EUR.USD"],
  );
  assert.deepEqual(
    persistedUnsupportedAssetSymbols(
      [
        {
          financialAssetKey: { symbol: "SPYL" },
          quantity: 1,
          settlementCurrencyKey: { code: "EUR" },
        },
        {
          financialAssetKey: { symbol: "AMD" },
          quantity: 1,
          settlementCurrencyKey: { code: "EUR" },
        },
      ],
      [{ symbol: "EUR.USD" }],
    ),
    [],
  );
});
