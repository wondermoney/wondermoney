import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildStartAccountCsvImportPayload,
  buildStartAccountCsvImportUrl,
} from "../useStartAccountCsvImport";

test("builds the account import url", () => {
  assert.equal(
    buildStartAccountCsvImportUrl("123"),
    "/v1/account/123/transaction/import",
  );
});

test("builds the account import payload with key only", () => {
  assert.deepEqual(buildStartAccountCsvImportPayload("csv-key"), {
    key: "csv-key",
  });
});
