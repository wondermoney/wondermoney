// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";

import enMessages from "../../../messages/en/common.json";
import { PortfolioImportConfirmStep } from "./PortfolioImportConfirmStep";
import { PortfolioImportPreviewStep } from "./PortfolioImportPreviewStep";
import { PortfolioImportTerminalStep } from "./PortfolioImportTerminalStep";

vi.mock("@/lib/api/portfolio/useConfirmPortfolioImportSession", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

afterEach(cleanup);

/*
 * Rows for an asset we cannot price are skipped. The user has to be told which
 * asset and how many rows before they confirm, and again on the result.
 */
const preview = {
  assetGroups: [],
  importSessionId: 41,
  limits: { rowsPerBucket: 25 },
  portfolioId: 7,
  rows: { duplicate: [], failed: [], invalid: [], needsAssetReview: [], ready: [] },
  status: "partial",
  summary: {
    duplicateRows: 0,
    failedRows: 0,
    importedRows: 2,
    invalidRows: 0,
    needsAssetReviewRows: 0,
    readyRows: 2,
    skippedRows: 46,
    totalRows: 48,
    unsupportedAssets: [{ symbol: "EUR.USD", skippedRows: 46 }],
  },
} as unknown as PortfolioImportSessionPreviewResponse;

const steps = {
  preview: <PortfolioImportPreviewStep preview={preview} />,
  confirm: (
    <PortfolioImportConfirmStep
      importSessionId={41}
      onChooseAnotherFile={() => {}}
      onConfirmed={() => {}}
      preview={preview}
    />
  ),
  terminal: <PortfolioImportTerminalStep onClose={() => {}} preview={preview} />,
};

for (const [name, step] of Object.entries(steps)) {
  test(`the ${name} step warns which unsupported asset will be skipped`, () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {step}
      </NextIntlClientProvider>,
    );

    assert.ok(screen.getByText(enMessages["portfolio-import-unsupported-assets-title"]));
    assert.ok(screen.getByText(/EUR\.USD/));
  });
}
