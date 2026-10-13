import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTranslator } from "next-intl";
import { test } from "vitest";

import { getPortfolioImportUnsupportedAssetWarnings } from "./import-session-unsupported-assets";

test("formats a safe unsupported asset symbol and localized skipped count", () => {
  const messages = JSON.parse(
    readFileSync(join(process.cwd(), "messages/en/common.json"), "utf8"),
  ) as Record<string, string>;
  const t = createTranslator({ locale: "en", messages });
  const [warning] = getPortfolioImportUnsupportedAssetWarnings([
    { symbol: "EUR.USD", skippedRows: 46 },
  ]);

  assert.ok(warning);
  assert.deepEqual(warning, { symbol: "EUR.USD", skippedRows: 46 });
  assert.equal(
    t("portfolio-import-unsupported-asset-warning", {
      count: warning?.skippedRows,
      symbol: warning?.symbol,
    }),
    "EUR.USD is not supported yet. 46 transactions will be skipped.",
  );
});

test("does not expose unsafe provider detail as an asset symbol", () => {
  assert.deepEqual(
    getPortfolioImportUnsupportedAssetWarnings([
      { symbol: "401 secret provider detail", skippedRows: 1 },
    ]),
    [],
  );
});

test("shows the structured unsupported asset alert in decision and terminal steps", () => {
  for (const fileName of [
    "PortfolioImportConfirmStep.tsx",
    "PortfolioImportPreviewStep.tsx",
    "PortfolioImportTerminalStep.tsx",
  ]) {
    const source = readFileSync(
      join(
        process.cwd(),
        "components/portfolio/import-session",
        fileName,
      ),
      "utf8",
    );

    assert.equal(source.includes("PortfolioImportUnsupportedAssetsAlert"), true);
  }
});
