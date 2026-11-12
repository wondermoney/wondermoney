import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildManualAssetTemplateCsv,
  MAX_MANUAL_ASSET_IMPORT_ROWS,
  parseManualAssetsCsv,
} from "./manual-asset-csv";

const today = new Date("2025-07-01T12:00:00Z");

test("reads the template's example rows as shared assets valued on their date", () => {
  const result = parseManualAssetsCsv(buildManualAssetTemplateCsv(), { locale: "en", today });

  assert.deepEqual(result.fileIssues, []);
  assert.deepEqual(
    result.rows.map((row) => row.row),
    [
      { currencyCode: "EUR", isPrivate: false, kind: "property", name: "Flat in Lisbon", value: 320000, valuationDate: "2025-06-30" },
      { currencyCode: "EUR", isPrivate: false, kind: "vehicle", name: "Family car", value: 14500, valuationDate: "2025-06-30" },
    ],
  );
});

test("matches headers in any case and order, and reads numbers in the reader's locale", () => {
  const csv = "currency,VALUE,name,kind,private\nusd,\"1.234,50\",Watch,Valuable,yes";

  const [row] = parseManualAssetsCsv(csv, { locale: "pt", today }).rows;

  assert.deepEqual(row.row, { currencyCode: "USD", isPrivate: true, kind: "valuable", name: "Watch", value: 1234.5 });
});

test("names each row's problems by line, and keeps the row out", () => {
  const csv = [
    "Name,Kind,Value,Valuation date,Currency",
    "Boat,yacht,10,2025-01-01,EUR",
    ",property,-5,2999-01-01,EURO",
    "Flat,property,100,2025-06-30,EUR",
  ].join("\n");

  const result = parseManualAssetsCsv(csv, { locale: "en", today });

  assert.deepEqual(
    result.rows.map((row) => ({ issues: row.issues, line: row.line, ok: row.row !== undefined })),
    [
      { issues: ["kind"], line: 2, ok: false },
      { issues: ["name", "value", "valuation-date", "currency"], line: 3, ok: false },
      { issues: [], line: 4, ok: true },
    ],
  );
});

test("refuses a file without the required columns, an empty file and an oversized one", () => {
  assert.deepEqual(parseManualAssetsCsv("Name,Value\nFlat,1", { locale: "en", today }).fileIssues, ["missing-columns"]);
  assert.deepEqual(parseManualAssetsCsv("Name,Kind,Value,Currency\n", { locale: "en", today }).fileIssues, ["empty-file"]);
  const many = ["Name,Kind,Value,Currency", ...Array.from({ length: MAX_MANUAL_ASSET_IMPORT_ROWS + 1 }, (_, index) => `Asset ${index},other,1,EUR`)].join("\n");
  assert.deepEqual(parseManualAssetsCsv(many, { locale: "en", today }).fileIssues, ["too-many-rows"]);
});
