import assert from "node:assert/strict";

import { test } from "vitest";

import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";

import { getPortfolioImportInitialLayout } from "../import-session-column-mapping";

test("uses confirmed layout when present", () => {
  const preview = {
    columnMapping: {
      confirmed: {
        layout: { headerRowIndex: 2, dataStartRowIndex: 3 },
      },
    },
  } satisfies Partial<PortfolioImportSessionPreviewResponse>;

  assert.deepEqual(
    getPortfolioImportInitialLayout(preview as PortfolioImportSessionPreviewResponse),
    { headerRowIndex: 2, dataStartRowIndex: 3 },
  );
});

test("uses suggestion layout when confirmation is absent", () => {
  const preview = {
    columnMapping: {
      suggestion: {
        layout: { headerRowIndex: 4, dataStartRowIndex: 5, footerRowCount: 1 },
      },
    },
  } satisfies Partial<PortfolioImportSessionPreviewResponse>;

  assert.deepEqual(
    getPortfolioImportInitialLayout(preview as PortfolioImportSessionPreviewResponse),
    { headerRowIndex: 4, dataStartRowIndex: 5, footerRowCount: 1 },
  );
});

test("uses column mapping layout when suggestion and confirmation are absent", () => {
  const preview = {
    columnMapping: {
      layout: { headerRowIndex: 1, dataStartRowIndex: 2 },
    },
  } satisfies Partial<PortfolioImportSessionPreviewResponse>;

  assert.deepEqual(
    getPortfolioImportInitialLayout(preview as PortfolioImportSessionPreviewResponse),
    { headerRowIndex: 1, dataStartRowIndex: 2 },
  );
});

test("falls back to default layout when preview omits layout", () => {
  assert.deepEqual(getPortfolioImportInitialLayout(undefined), {
    headerRowIndex: 0,
    dataStartRowIndex: 1,
  });
});
