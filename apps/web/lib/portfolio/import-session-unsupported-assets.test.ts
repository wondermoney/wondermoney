import assert from "node:assert/strict";

import { createTranslator } from "next-intl";
import { test } from "vitest";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import { getPortfolioImportUnsupportedAssetWarnings } from "./import-session-unsupported-assets";

test("keeps a safe unsupported asset symbol and its skipped count", () => {
  assert.deepEqual(
    getPortfolioImportUnsupportedAssetWarnings([{ symbol: "EUR.USD", skippedRows: 46 }]),
    [{ symbol: "EUR.USD", skippedRows: 46 }],
  );
});

for (const [locale, messages] of [["en", enMessages], ["pt", ptMessages], ["es", esMessages]] as const) {
  test(`the warning names the asset and how many rows it skips (${locale})`, () => {
    const t = createTranslator({ locale, messages });
    const [warning] = getPortfolioImportUnsupportedAssetWarnings([{ symbol: "EUR.USD", skippedRows: 46 }]);
    assert.ok(warning);

    const text = t("portfolio-import-unsupported-asset-warning", {
      count: warning.skippedRows,
      symbol: warning.symbol,
    });

    assert.match(text, /EUR\.USD/);
    assert.match(text, /46/);
  });
}

test("does not expose unsafe provider detail as an asset symbol", () => {
  assert.deepEqual(
    getPortfolioImportUnsupportedAssetWarnings([
      { symbol: "401 secret provider detail", skippedRows: 1 },
    ]),
    [],
  );
});
