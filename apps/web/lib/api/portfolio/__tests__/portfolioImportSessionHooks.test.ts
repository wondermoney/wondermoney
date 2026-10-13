import assert from "node:assert/strict";

import { test } from "vitest";

import type { PortfolioImportAssetMappingDecision } from "../importSessionTypes";
import {
  buildConfirmPortfolioImportAssetMappingsPayload,
  buildConfirmPortfolioImportAssetMappingsUrl,
} from "../useConfirmPortfolioImportAssetMappings";
import {
  buildConfirmPortfolioImportColumnMappingPayload,
  buildConfirmPortfolioImportColumnMappingUrl,
} from "../useConfirmPortfolioImportColumnMapping";
import { buildConfirmPortfolioImportSessionUrl } from "../useConfirmPortfolioImportSession";
import {
  buildCreatePortfolioImportSessionPayload,
  buildCreatePortfolioImportSessionUrl,
} from "../useCreatePortfolioImportSession";
import {
  buildPortfolioImportSessionPreviewUrl,
  portfolioImportSessionPreviewQueryKey,
} from "../usePortfolioImportSessionPreview";
import {
  buildSuggestPortfolioImportColumnMappingPayload,
  buildSuggestPortfolioImportColumnMappingUrl,
} from "../useSuggestPortfolioImportColumnMapping";
import { buildTriggerPortfolioImportSessionParseUrl } from "../useTriggerPortfolioImportSessionParse";

test("builds the portfolio import session create url", () => {
  assert.equal(buildCreatePortfolioImportSessionUrl(12), "/v1/portfolio/12/import-sessions");
});

test("builds the portfolio import session create payload", () => {
  assert.deepEqual(buildCreatePortfolioImportSessionPayload(), { mode: "review" });
});

test("builds the portfolio import session create payload with broker context", () => {
  assert.deepEqual(buildCreatePortfolioImportSessionPayload({ brokerId: 17 }), {
    brokerId: 17,
    mode: "review",
  });
});

test("builds the portfolio import session create payload without broker context", () => {
  assert.deepEqual(buildCreatePortfolioImportSessionPayload({}), { mode: "review" });
});

test("builds the portfolio import session parse url", () => {
  assert.equal(buildTriggerPortfolioImportSessionParseUrl(456), "/v1/portfolio-import-sessions/456/parse");
});

test("builds the portfolio import session preview url with default limit", () => {
  assert.equal(buildPortfolioImportSessionPreviewUrl(456), "/v1/portfolio-import-sessions/456?limit=25");
});

test("builds the portfolio import session preview url with explicit limit", () => {
  assert.equal(buildPortfolioImportSessionPreviewUrl(456, 50), "/v1/portfolio-import-sessions/456?limit=50");
});

test("builds the portfolio import session preview query key", () => {
  assert.deepEqual(portfolioImportSessionPreviewQueryKey(456), ["portfolio-import-session-preview", 456, 25]);
  assert.deepEqual(portfolioImportSessionPreviewQueryKey(456, 50), ["portfolio-import-session-preview", 456, 50]);
});

test("builds the suggest column mapping url", () => {
  assert.equal(buildSuggestPortfolioImportColumnMappingUrl(456), "/v1/portfolio-import-sessions/456/column-mapping/suggest");
});

test("builds an empty suggest column mapping payload", () => {
  assert.deepEqual(buildSuggestPortfolioImportColumnMappingPayload(), {});
});

test("builds the confirm column mapping url", () => {
  assert.equal(buildConfirmPortfolioImportColumnMappingUrl(456), "/v1/portfolio-import-sessions/456/column-mapping");
});

test("builds the confirm column mapping payload", () => {
  assert.deepEqual(
    buildConfirmPortfolioImportColumnMappingPayload(
      { transactionDate: "tradeDate" },
      { currency: "EUR" },
      { transactionType: "quantitySign" },
      { headerRowIndex: 1, dataStartRowIndex: 2 },
      { dateFormat: "YYYY-MM-DD" },
    ),
    {
      columnMapping: { transactionDate: "tradeDate" },
      fixedValues: { currency: "EUR" },
      derivedValues: { transactionType: "quantitySign" },
      layout: { headerRowIndex: 1, dataStartRowIndex: 2 },
      transformations: { dateFormat: "YYYY-MM-DD" },
    },
  );
});

test("builds the confirm column mapping payload with default transformations", () => {
  assert.deepEqual(
    buildConfirmPortfolioImportColumnMappingPayload({ ticker: "symbol" }),
    {
      columnMapping: { ticker: "symbol" },
      fixedValues: {},
      derivedValues: {},
      layout: { headerRowIndex: 0, dataStartRowIndex: 1 },
      transformations: {},
    },
  );
});

test("builds the confirm asset mappings url and payload", () => {
  assert.equal(buildConfirmPortfolioImportAssetMappingsUrl(456), "/v1/portfolio-import-sessions/456/asset-mappings");
  const decisions: PortfolioImportAssetMappingDecision[] = [
    { action: "skip_group", groupId: 1, skipReason: "duplicate" },
    { action: "use_candidate", groupId: 2, candidateId: 99 },
    { action: "use_existing_asset", groupId: 3, financialAssetId: 88 },
  ];
  assert.deepEqual(buildConfirmPortfolioImportAssetMappingsPayload(decisions), {
    decisions,
  });
});

test("builds the final confirm url", () => {
  assert.equal(buildConfirmPortfolioImportSessionUrl(456), "/v1/portfolio-import-sessions/456/confirm");
});

test("builds the confirm session url for string ids", () => {
  assert.equal(buildConfirmPortfolioImportSessionUrl("456"), "/v1/portfolio-import-sessions/456/confirm");
});
