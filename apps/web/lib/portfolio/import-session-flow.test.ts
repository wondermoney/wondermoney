import assert from "node:assert/strict";

import { test } from "vitest";

import {
  canConfirmPortfolioImport,
  getPortfolioImportLedgerCounts,
  getPortfolioImportTerminalFailureReason,
  hasBlockingAssetReview,
  isDuplicateOnlyResult,
  resolvePortfolioImportStep,
  resolvePortfolioImportVisibleStep,
} from "./import-session-flow";

const rad80DuplicateOnlySummary = {
  totalRows: 5,
  readyRows: 0,
  duplicateRows: 3,
  invalidRows: 0,
  needsAssetReviewRows: 0,
  skippedRows: 3,
  importedRows: 0,
  failedRows: 0,
};

const nonDuplicatePartialSummary = {
  totalRows: 4,
  readyRows: 3,
  duplicateRows: 1,
  invalidRows: 0,
  needsAssetReviewRows: 0,
  skippedRows: 1,
  importedRows: 0,
  failedRows: 0,
};

test("maps status to portfolio import step", () => {
  assert.equal(resolvePortfolioImportStep(undefined), "upload");
  assert.equal(resolvePortfolioImportStep("waiting_for_upload"), "upload");
  assert.equal(resolvePortfolioImportStep("uploaded"), "upload");
  assert.equal(resolvePortfolioImportStep("parsing"), "analyzing");
  assert.equal(resolvePortfolioImportStep("needs_column_mapping"), "columnMapping");
  assert.equal(resolvePortfolioImportStep("needs_asset_review"), "assetReview");
  assert.equal(resolvePortfolioImportStep("ready_to_import"), "confirm");
  assert.equal(resolvePortfolioImportStep("importing"), "terminal");
  assert.equal(resolvePortfolioImportStep("succeeded"), "terminal");
  assert.equal(resolvePortfolioImportStep("partial"), "preview");
  assert.equal(resolvePortfolioImportStep("failed"), "terminal");
  assert.equal(resolvePortfolioImportStep("cancelled"), "terminal");
  assert.equal(resolvePortfolioImportStep("expired"), "terminal");
});

test("maps visible step for final partial and duplicate-only terminal results", () => {
  assert.equal(
    resolvePortfolioImportVisibleStep({ status: "partial", summary: nonDuplicatePartialSummary }),
    "confirm",
  );
  assert.equal(
    resolvePortfolioImportVisibleStep({
      status: "partial",
      summary: rad80DuplicateOnlySummary,
    }),
    "terminal",
  );
  assert.equal(
    resolvePortfolioImportVisibleStep({
      status: "partial",
      isFinalizing: true,
      summary: nonDuplicatePartialSummary,
    }),
    "confirm",
  );
  assert.equal(
    resolvePortfolioImportVisibleStep({
      status: "partial",
      isFinalizing: true,
      summary: {
        ...nonDuplicatePartialSummary,
        importedRows: 1,
      },
    }),
    "terminal",
  );
  assert.equal(
    resolvePortfolioImportVisibleStep({
      status: "partial",
      summary: {
        ...nonDuplicatePartialSummary,
        canConfirm: true,
        terminalKind: "duplicate_only",
      },
    }),
    "terminal",
  );
});

test("covers the portfolio import visible step ladder from upload through terminal", () => {
  assert.equal(resolvePortfolioImportVisibleStep({ status: "waiting_for_upload" }), "upload");
  assert.equal(resolvePortfolioImportVisibleStep({ status: "uploaded" }), "upload");
  assert.equal(resolvePortfolioImportVisibleStep({ status: "parsing" }), "analyzing");
  assert.equal(resolvePortfolioImportVisibleStep({ status: "needs_column_mapping" }), "columnMapping");
  assert.equal(resolvePortfolioImportVisibleStep({ status: "needs_asset_review" }), "assetReview");
  assert.equal(resolvePortfolioImportVisibleStep({ status: "ready_to_import" }), "confirm");
  assert.equal(resolvePortfolioImportVisibleStep({ status: "importing" }), "terminal");
  assert.equal(resolvePortfolioImportVisibleStep({ status: "succeeded" }), "terminal");
});

test("keeps partial sessions in preview until confirm eligibility is met", () => {
  assert.equal(
    resolvePortfolioImportVisibleStep({
      status: "partial",
      summary: {
        totalRows: 1,
        readyRows: 0,
        duplicateRows: 0,
        invalidRows: 0,
        needsAssetReviewRows: 0,
        skippedRows: 0,
        importedRows: 0,
        failedRows: 0,
      },
    }),
    "preview",
  );
  assert.equal(
    resolvePortfolioImportVisibleStep({
      status: "partial",
      summary: {
        ...nonDuplicatePartialSummary,
        canConfirm: true,
      },
    }),
    "confirm",
  );
});

test("only ready_to_import is confirm-ready", () => {
  assert.equal(canConfirmPortfolioImport(undefined), false);
  assert.equal(canConfirmPortfolioImport("needs_column_mapping"), false);
  assert.equal(canConfirmPortfolioImport("needs_asset_review"), false);
  assert.equal(canConfirmPortfolioImport("ready_to_import"), true);
  assert.equal(canConfirmPortfolioImport("importing"), false);
  assert.equal(canConfirmPortfolioImport("succeeded"), false);
});

test("detects duplicate-only terminal results", () => {
  assert.equal(isDuplicateOnlyResult(undefined), false);
  assert.equal(
    isDuplicateOnlyResult(rad80DuplicateOnlySummary),
    true,
  );
  assert.equal(
    isDuplicateOnlyResult({ totalRows: 4, duplicateRows: 4, invalidRows: 0, readyRows: 0, needsAssetReviewRows: 0, skippedRows: 0, importedRows: 0, failedRows: 0 }),
    true,
  );
  assert.equal(
    isDuplicateOnlyResult({ totalRows: 4, duplicateRows: 1, invalidRows: 0, readyRows: 0, needsAssetReviewRows: 0, skippedRows: 3, importedRows: 0, failedRows: 1 }),
    false,
  );
  assert.equal(
    isDuplicateOnlyResult({ totalRows: 4, duplicateRows: 1, invalidRows: 0, readyRows: 0, needsAssetReviewRows: 0, skippedRows: 3, importedRows: 1, failedRows: 0 }),
    false,
  );
  assert.equal(
    isDuplicateOnlyResult({ totalRows: 4, duplicateRows: 1, invalidRows: 0, readyRows: 2, needsAssetReviewRows: 0, skippedRows: 1, importedRows: 0, failedRows: 0 }),
    false,
  );
  assert.equal(
    isDuplicateOnlyResult({ totalRows: 4, duplicateRows: 1, invalidRows: 1, readyRows: 0, needsAssetReviewRows: 0, skippedRows: 1, importedRows: 0, failedRows: 0 }),
    false,
  );
  assert.equal(
    isDuplicateOnlyResult({ totalRows: 4, duplicateRows: 1, invalidRows: 0, readyRows: 0, needsAssetReviewRows: 1, skippedRows: 1, importedRows: 0, failedRows: 0 }),
    false,
  );
});

test("normalizes ledger counts with optional imported and failed fields", () => {
  assert.deepEqual(
    getPortfolioImportLedgerCounts({
      totalRows: 10,
      readyRows: 4,
      duplicateRows: 2,
      invalidRows: 1,
      needsAssetReviewRows: 2,
      skippedRows: 1,
      importedRows: 3,
      failedRows: 1,
    }),
    {
      total: 10,
      ready: 4,
      duplicates: 2,
      invalid: 1,
      review: 2,
      skipped: 1,
      imported: 3,
      failed: 1,
    },
  );
  assert.deepEqual(
    getPortfolioImportLedgerCounts({ totalRows: 1, readyRows: 1, duplicateRows: 0, invalidRows: 0, needsAssetReviewRows: 0, skippedRows: 0 }),
    { total: 1, ready: 1, duplicates: 0, invalid: 0, review: 0, skipped: 0, imported: 0, failed: 0 },
  );
  assert.deepEqual(
    getPortfolioImportLedgerCounts({
      totalRows: 2,
      readyRows: 1,
      duplicateRows: 0,
      invalidRows: 0,
      needsAssetReviewRows: 0,
      skippedRows: 1,
      userSkippedRows: 2,
    }),
    { total: 2, ready: 1, duplicates: 0, invalid: 0, review: 0, skipped: 2, imported: 0, failed: 0 },
  );
});

test("respects authoritative canConfirm", () => {
  assert.equal(
    canConfirmPortfolioImport("partial", {
      canConfirm: true,
      duplicateRows: 0,
      failedRows: 0,
      importedRows: 0,
      invalidRows: 0,
      needsAssetReviewRows: 0,
      readyRows: 0,
      skippedRows: 0,
      totalRows: 0,
    }),
    true,
  );
});

test("keeps supported rows confirmable when unsupported assets are skipped", () => {
  assert.equal(
    canConfirmPortfolioImport("partial", {
      duplicateRows: 0,
      invalidRows: 0,
      needsAssetReviewRows: 0,
      readyRows: 31,
      skippedRows: 46,
      totalRows: 77,
      unsupportedAssets: [{ symbol: "EUR.USD", skippedRows: 46 }],
    }),
    true,
  );
});

test("detects blocking asset review rows", () => {
  assert.equal(hasBlockingAssetReview(undefined), false);
  assert.equal(
    hasBlockingAssetReview({
      status: "ready_to_import",
      rows: { duplicate: [], invalid: [], needsAssetReview: [{ id: 1, rowNumber: 1, raw: {}, status: "needs_asset_review" }], ready: [] },
      assetGroups: [{ id: 1, identity: {}, status: "ambiguous" }],
      limits: { rowsPerBucket: 100 },
      importSessionId: 1,
      portfolioId: 1,
      summary: { totalRows: 1, readyRows: 0, duplicateRows: 0, invalidRows: 0, needsAssetReviewRows: 1, skippedRows: 0 },
    }),
    true,
  );
  assert.equal(
    hasBlockingAssetReview({
      status: "ready_to_import",
      rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [{ id: 1, rowNumber: 1, raw: {}, status: "ready" }] },
      assetGroups: [],
      limits: { rowsPerBucket: 100 },
      importSessionId: 1,
      portfolioId: 1,
      summary: { totalRows: 1, readyRows: 1, duplicateRows: 0, invalidRows: 0, needsAssetReviewRows: 0, skippedRows: 0 },
    }),
    false,
  );
  assert.equal(
    hasBlockingAssetReview({
      status: "ready_to_import",
      rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [] },
      assetGroups: [{ id: 1, identity: {}, status: "provider_error" }],
      limits: { rowsPerBucket: 100 },
      importSessionId: 1,
      portfolioId: 1,
      summary: { totalRows: 1, readyRows: 1, duplicateRows: 0, invalidRows: 0, needsAssetReviewRows: 0, skippedRows: 0 },
    }),
    true,
  );
});

test("surfaces human readable terminal failure reasons", () => {
  assert.equal(
    getPortfolioImportTerminalFailureReason({
      status: "failed",
      summary: { ...nonDuplicatePartialSummary, failureReason: "Broker rejected the file." },
    }),
    "Broker rejected the file.",
  );
  assert.equal(
    getPortfolioImportTerminalFailureReason({
      status: "failed",
      summary: { ...nonDuplicatePartialSummary, failureReason: "portfolio-import-terminal-failed" },
    }),
    undefined,
  );
});
