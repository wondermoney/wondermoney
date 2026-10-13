import assert from "node:assert/strict";

import { test } from "vitest";

import {
  sanitizePortfolioImportAnalyticsProperties,
} from "./portfolio-import";

test("sanitizes portfolio import analytics properties", () => {
  assert.deepEqual(
    sanitizePortfolioImportAnalyticsProperties({
      error_category: "upload",
      fileName: "secret.csv",
      row_count: 12,
      s3_key: "bucket/private.csv",
      nested: {
        RawRows: [
          { assetName: "Hidden Asset", ticker: "HIDE" },
          { rowCount: 2 },
        ],
        safeValue: "keep-me",
      },
    }),
    {
      error_category: "upload",
      nested: {
        safeValue: "keep-me",
      },
      row_count: 12,
    },
  );
});
