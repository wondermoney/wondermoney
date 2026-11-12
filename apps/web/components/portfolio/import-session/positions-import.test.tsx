// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeAll, test, vi } from "vitest";

import type {
  PortfolioImportPreviewRow,
  PortfolioImportSessionPreviewResponse,
} from "@/lib/api/portfolio/importSessionTypes";

import enMessages from "../../../messages/en/common.json";
import esMessages from "../../../messages/es/common.json";
import ptMessages from "../../../messages/pt/common.json";
import { PortfolioImportColumnMappingStep } from "./PortfolioImportColumnMappingStep";
import { PortfolioImportConfirmStep } from "./PortfolioImportConfirmStep";
import { PortfolioImportModeSelector } from "./PortfolioImportModeSelector";

const state = vi.hoisted(() => ({
  confirm: vi.fn(),
  updateInclusion: vi.fn(),
}));

vi.mock("@/lib/api/portfolio/useUpdatePortfolioImportRowInclusion", () => ({
  default: () => ({ isPending: false, mutateAsync: state.updateInclusion }),
}));
vi.mock("@/lib/api/portfolio/useConfirmPortfolioImportSession", () => ({
  default: () => ({ isPending: false, mutateAsync: state.confirm }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  state.confirm.mockReset();
  state.updateInclusion.mockReset();
});

const m = enMessages as unknown as Record<string, string>;

/** The import modal wraps every step in its own form; the mapping fields read it. */
function ModalForm({ children }: { children: ReactNode }) {
  const methods = useForm();
  return <FormProvider {...methods}>{children}</FormProvider>;
}

function renderWith(node: ReactNode, messages: Record<string, unknown> = enMessages, locale = "en") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ModalForm>{node}</ModalForm>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function heldBackRow(overrides: Partial<PortfolioImportPreviewRow> = {}): PortfolioImportPreviewRow {
  return {
    id: 31,
    normalized: { existingTrades: true, quantity: 10, ticker: "AAPL", unitPrice: 150 },
    raw: { Symbol: "AAPL" },
    rowNumber: 2,
    skipReason: "Asset already has trades in this portfolio",
    status: "skipped",
    ...overrides,
  };
}

function positionsPreview(
  rows: PortfolioImportPreviewRow[],
  summary: Partial<PortfolioImportSessionPreviewResponse["summary"]> = {},
): PortfolioImportSessionPreviewResponse {
  return {
    assetGroups: [],
    importSessionId: 41,
    importType: "positions",
    limits: { rowsPerBucket: 25 },
    portfolioId: 7,
    rows: { duplicate: [], existingTrades: rows, invalid: [], needsAssetReview: [], ready: [] },
    status: "partial",
    summary: {
      canConfirm: true,
      duplicateRows: 0,
      existingTradeRows: rows.length,
      existingTradeSkippedRows: rows.filter((row) => row.status === "skipped").length,
      importedRows: 0,
      invalidRows: 0,
      needsAssetReviewRows: 0,
      readyRows: 1,
      skippedRows: 1,
      totalRows: 2,
      ...summary,
    },
  };
}

test("offers trades, positions and manual assets, and moves between them with the arrow keys", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWith(<PortfolioImportModeSelector value="trades" onChange={onChange} />);

  const radios = screen.getAllByRole("radio");
  assert.deepEqual(
    radios.map((radio) => radio.getAttribute("aria-checked")),
    ["true", "false", "false"],
  );
  await user.click(screen.getByRole("radio", { name: new RegExp(m["portfolio-import-mode-positions"]) }));
  assert.deepEqual(onChange.mock.calls.at(-1), ["positions"]);

  radios[0].focus();
  await user.keyboard("{ArrowLeft}");
  assert.deepEqual(onChange.mock.calls.at(-1), ["manualAssets"]);
});

test("maps a positions file without a transaction type, and buys undated rows on the as-of day", async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  renderWith(
    <PortfolioImportColumnMappingStep
      availableColumns={["ISIN", "Qty", "Average cost", "Currency"]}
      importType="positions"
      initialAsOfDate="2024-12-31"
      initialMapping={{ currency: "Currency", isin: "ISIN", quantity: "Qty", unitPrice: "Average cost" }}
      hasWarning={false}
      isSubmitting={false}
      onSubmit={onSubmit}
    />,
  );

  screen.getByText(m["portfolio-import-positions-as-of-label"]);
  screen.getByText(m["portfolio-import-positions-as-of-hint"]);
  assert.equal(screen.queryByText(m["portfolio-import-column-transaction-type"]), null);

  await user.click(screen.getByRole("button", { name: m["portfolio-import-column-mapping-save"] }));

  await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
  const [submitted] = onSubmit.mock.calls[0];
  assert.equal(submitted.asOfDate, "2024-12-31");
  assert.deepEqual(submitted.columnMapping, { currency: "Currency", isin: "ISIN", quantity: "Qty", unitPrice: "Average cost" });
});

test("does not let the same holdings file through as a trade history", async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  renderWith(
    <PortfolioImportColumnMappingStep
      availableColumns={["ISIN", "Qty", "Average cost", "Currency"]}
      initialMapping={{ currency: "Currency", isin: "ISIN", quantity: "Qty", unitPrice: "Average cost" }}
      hasWarning={false}
      isSubmitting={false}
      onSubmit={onSubmit}
    />,
  );

  assert.equal(screen.queryByText(m["portfolio-import-positions-as-of-label"]), null);
  await user.click(screen.getByRole("button", { name: m["portfolio-import-column-mapping-save"] }));

  screen.getByText(m["portfolio-import-column-validation-transaction-date"]);
  assert.equal(onSubmit.mock.calls.length, 0);
});

test("warns about rows for assets with trades and includes one when the person switches it on", async () => {
  state.updateInclusion.mockResolvedValue({});
  const refetch = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderWith(
    <PortfolioImportConfirmStep
      importSessionId={41}
      onChooseAnotherFile={() => {}}
      onConfirmed={() => {}}
      onPreviewRefetch={refetch}
      preview={positionsPreview([heldBackRow()])}
    />,
  );

  screen.getByText("1 row is for an asset that already has trades");
  const toggle = screen.getByRole("switch", { name: "Include AAPL as an opening buy" });
  assert.equal(toggle.getAttribute("aria-checked"), "false");

  await user.click(toggle);

  await waitFor(() => assert.equal(refetch.mock.calls.length, 1));
  assert.deepEqual(state.updateInclusion.mock.calls[0][0], { importSessionId: 41, rows: [{ include: true, rowId: 31 }] });
});

test("skips an included row again", async () => {
  state.updateInclusion.mockResolvedValue({});
  const user = userEvent.setup();
  renderWith(
    <PortfolioImportConfirmStep
      importSessionId={41}
      onChooseAnotherFile={() => {}}
      onConfirmed={() => {}}
      onPreviewRefetch={() => Promise.resolve()}
      preview={positionsPreview([heldBackRow({ skipReason: undefined, status: "ready" })], { existingTradeSkippedRows: 0, readyRows: 2, skippedRows: 0 })}
    />,
  );

  await user.click(screen.getByRole("switch", { name: "Include AAPL as an opening buy" }));

  await waitFor(() => assert.deepEqual(state.updateInclusion.mock.calls[0][0].rows, [{ include: false, rowId: 31 }]));
});

test("blocks the import while every row is held back, and says how to go on", () => {
  renderWith(
    <PortfolioImportConfirmStep
      importSessionId={41}
      onChooseAnotherFile={() => {}}
      onConfirmed={() => {}}
      preview={positionsPreview([heldBackRow()], { canConfirm: false, readyRows: 0 })}
    />,
  );

  screen.getByText(m["portfolio-import-existing-trades-nothing-left"]);
  assert.equal(screen.getByRole("button", { name: m["portfolio-import-confirm-action"] }).hasAttribute("disabled"), true);
});

test("shows nothing about existing trades for a trades import", () => {
  renderWith(
    <PortfolioImportConfirmStep
      importSessionId={41}
      onChooseAnotherFile={() => {}}
      onConfirmed={() => {}}
      preview={{ ...positionsPreview([]), importType: "trades" }}
    />,
  );

  assert.equal(screen.queryByRole("switch"), null);
});

for (const { locale, messages } of [
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
]) {
  test(`renders the existing-trades warning in ${locale}`, () => {
    renderWith(
      <PortfolioImportConfirmStep
        importSessionId={41}
        onChooseAnotherFile={() => {}}
        onConfirmed={() => {}}
        preview={positionsPreview([heldBackRow()])}
      />,
      messages,
      locale,
    );

    screen.getByText(messages["portfolio-import-existing-trades-description"]);
  });
}
