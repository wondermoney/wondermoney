// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";

import enMessages from "../../../messages/en/common.json";
import esMessages from "../../../messages/es/common.json";
import ptMessages from "../../../messages/pt/common.json";
import { PortfolioImportPreviewStep } from "./PortfolioImportPreviewStep";
import { PortfolioImportTerminalStep } from "./PortfolioImportTerminalStep";

afterEach(cleanup);

const failedRow = {
  failureReason: "Insufficient quantity to sell",
  id: 707,
  raw: { Symbol: "AMD" },
  rowNumber: 7,
  status: "failed" as const,
};

function preview(
  overrides: Partial<PortfolioImportSessionPreviewResponse> = {},
  failed: (typeof failedRow)[] | null = [failedRow],
): PortfolioImportSessionPreviewResponse {
  return {
    assetGroups: [],
    importSessionId: 41,
    limits: { rowsPerBucket: 25 },
    portfolioId: 7,
    rows: {
      duplicate: [],
      ...(failed ? { failed } : {}),
      invalid: [],
      needsAssetReview: [],
      ready: [],
    },
    status: "partial",
    summary: {
      duplicateRows: 0,
      failedRows: failed?.length ?? 0,
      importedRows: 2,
      invalidRows: 0,
      needsAssetReviewRows: 0,
      readyRows: 0,
      skippedRows: 0,
      totalRows: 3,
    },
    ...overrides,
  } as PortfolioImportSessionPreviewResponse;
}

for (const { locale, messages } of [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const) {
  test(`the finished import lists each failed row with its reason (${locale})`, async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PortfolioImportTerminalStep onClose={() => {}} preview={preview()} />
      </NextIntlClientProvider>,
    );

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(messages["portfolio-import-details-failed"]),
      }),
    );

    assert.ok(screen.getByText("Insufficient quantity to sell"));
    assert.ok(screen.getByText("7"));
  });
}

test("the preview step lists failed rows with their reason", async () => {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PortfolioImportPreviewStep preview={preview()} />
    </NextIntlClientProvider>,
  );

  await user.click(
    screen.getByRole("button", {
      name: new RegExp(enMessages["portfolio-import-details-failed"]),
    }),
  );

  assert.ok(screen.getByText("Insufficient quantity to sell"));
});

test("a wholly failed import still lists the rows that failed", async () => {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PortfolioImportTerminalStep
        onClose={() => {}}
        preview={preview({ status: "failed" })}
      />
    </NextIntlClientProvider>,
  );

  await user.click(
    screen.getByRole("button", {
      name: new RegExp(enMessages["portfolio-import-details-failed"]),
    }),
  );

  assert.ok(screen.getByText("Insufficient quantity to sell"));
});

test("no failed group when nothing failed, or when the API predates the bucket", () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PortfolioImportPreviewStep preview={preview({}, [])} />
      <PortfolioImportTerminalStep
        onClose={() => {}}
        preview={preview({}, null)}
      />
    </NextIntlClientProvider>,
  );

  assert.equal(
    screen.queryByText(enMessages["portfolio-import-details-failed"]),
    null,
  );
});
