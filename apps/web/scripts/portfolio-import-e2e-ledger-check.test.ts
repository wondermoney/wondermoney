import assert from "node:assert/strict";

import { it } from "vitest";

import { BROKER_IMPORT_CASES } from "../cypress/e2e/portfolio-import/cases";
import { checkOriginalIbkrStoredFeeLedger } from "./portfolio-import-e2e-ledger-check.mjs";

it("checks original IBKR raw and per-transaction persisted fee totals independently", () => {
  assert.deepEqual(checkOriginalIbkrStoredFeeLedger(), {
    acceptedRows: 30,
    perRowStoredTotal: "22.5457",
    rawNominalMixedCurrencyTotal: "22.545189575000",
    globallyRoundedTotal: "22.5452",
  });
  const originalIbkr = BROKER_IMPORT_CASES.find(
    (input) => input.fixture === "portfolio-import/ibkr-flex-query.csv.base64",
  );
  assert.ok(originalIbkr);
  assert.equal(originalIbkr.expectedFeeTotal, 22.5457);
});
