import assert from "node:assert/strict";

import Papa from "papaparse";
import { test } from "vitest";

import {
  buildGenericCsvTemplate,
  GENERIC_CSV_COLUMNS,
} from "./account-csv-generic-format";

const types = [
  { transactionTypeKey: 4, name: "PAYMENT" },
  { transactionTypeKey: 9, name: "DEPOSIT" },
];

test("the template's header is exactly the columns the generic import reads", () => {
  const [header] = buildGenericCsvTemplate(types).split("\n");
  assert.deepEqual(header?.split(","), [...GENERIC_CSV_COLUMNS]);
});

test("the template's example rows use the instance's own type codes", () => {
  const parsed = Papa.parse<Record<string, string>>(
    buildGenericCsvTemplate(types),
    { header: true },
  );
  assert.deepEqual(
    parsed.data.map((row) => row.transactionTypeKey),
    ["4", "9"],
  );
  for (const row of parsed.data) assert.ok(Number(row.amount) > 0);
});

test("without known types the template is the header alone", () => {
  assert.equal(
    buildGenericCsvTemplate([]).trim(),
    GENERIC_CSV_COLUMNS.join(","),
  );
});
