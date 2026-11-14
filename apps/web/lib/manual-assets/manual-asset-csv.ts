import Papa from "papaparse";

import {
  type EditableManualAssetKind,
  MANUAL_ASSET_KINDS,
} from "@/lib/api/manual-asset/types";
import { parseLocaleNumber } from "@/lib/utils/number";

/**
 * The manual-assets template: one asset and its value on a day per row. The header is matched
 * case-insensitively, so a re-saved spreadsheet still reads; `Private` and `Valuation date` may
 * be left out (shared, valued today).
 */
export const MANUAL_ASSET_TEMPLATE_COLUMNS = [
  "Name",
  "Kind",
  "Value",
  "Valuation date",
  "Currency",
  "Private",
] as const;

/** At most this many assets in one file, as the API allows. */
export const MAX_MANUAL_ASSET_IMPORT_ROWS = 500;

export function buildManualAssetTemplateCsv() {
  return [
    MANUAL_ASSET_TEMPLATE_COLUMNS.join(","),
    "Flat in Lisbon,property,320000,2025-06-30,EUR,no",
    "Family car,vehicle,14500,2025-06-30,EUR,no",
  ].join("\n");
}

export interface ManualAssetImportRow {
  name: string;
  kind: EditableManualAssetKind;
  value: number;
  /** `YYYY-MM-DD`; absent means today. */
  valuationDate?: string;
  currencyCode: string;
  isPrivate: boolean;
}

export type ManualAssetImportIssue =
  | "missing-columns"
  | "empty-file"
  | "too-many-rows"
  | "name"
  | "kind"
  | "value"
  | "valuation-date"
  | "currency"
  | "private";

export interface ManualAssetImportRowResult {
  /** The row's line in the file, counting the header as line 1. */
  line: number;
  row?: ManualAssetImportRow;
  issues: ManualAssetImportIssue[];
}

export interface ManualAssetImportParseResult {
  /** Problems with the file as a whole; when any, `rows` is empty. */
  fileIssues: ManualAssetImportIssue[];
  rows: ManualAssetImportRowResult[];
}

const HEADER_ALIASES: Record<string, keyof ManualAssetImportRow> = {
  currency: "currencyCode",
  date: "valuationDate",
  kind: "kind",
  name: "name",
  private: "isPrivate",
  type: "kind",
  "valuation date": "valuationDate",
  value: "value",
};

const REQUIRED_FIELDS: (keyof ManualAssetImportRow)[] = [
  "name",
  "kind",
  "value",
  "currencyCode",
];

const TRUE_WORDS = new Set(["yes", "true", "1", "y", "sim", "sí", "si"]);
const FALSE_WORDS = new Set(["no", "false", "0", "n", "não", "nao", ""]);

function isCalendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Reads a manual-assets file into rows the import endpoint takes, with the problems of each row,
 * so the person can fix the file before anything is created. Numbers are read in the reader's
 * locale ("1.234,56" is 1234.56). `today` bounds valuation dates (tomorrow in UTC is allowed, as
 * the API allows it).
 */
export function parseManualAssetsCsv(
  text: string,
  options: { locale: string; today?: Date },
): ManualAssetImportParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const fields = new Set(
    (parsed.meta.fields ?? []).flatMap((header) => {
      const field = HEADER_ALIASES[header];
      return field ? [field] : [];
    }),
  );
  if (!REQUIRED_FIELDS.every((field) => fields.has(field))) {
    return { fileIssues: ["missing-columns"], rows: [] };
  }
  if (parsed.data.length === 0) return { fileIssues: ["empty-file"], rows: [] };
  if (parsed.data.length > MAX_MANUAL_ASSET_IMPORT_ROWS) {
    return { fileIssues: ["too-many-rows"], rows: [] };
  }

  const today = options.today ?? new Date();
  const latestDay = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
  const rows = parsed.data.map((record, index): ManualAssetImportRowResult => {
    const cell = (field: keyof ManualAssetImportRow) => {
      const header = Object.keys(record).find((key) => HEADER_ALIASES[key] === field);
      return (header ? record[header] : undefined)?.trim() ?? "";
    };
    const issues: ManualAssetImportIssue[] = [];

    const name = cell("name");
    if (!name || name.length > 255) issues.push("name");

    const kind = cell("kind").toLowerCase() as EditableManualAssetKind;
    if (!MANUAL_ASSET_KINDS.includes(kind)) issues.push("kind");

    const value = parseLocaleNumber(cell("value"), options.locale);
    if (value === null || value < 0 || value > 99_999_999_999) issues.push("value");

    const valuationDate = cell("valuationDate");
    if (valuationDate && (!isCalendarDay(valuationDate) || valuationDate > latestDay)) {
      issues.push("valuation-date");
    }

    const currencyCode = cell("currencyCode").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) issues.push("currency");

    const privateCell = cell("isPrivate").toLowerCase();
    if (!TRUE_WORDS.has(privateCell) && !FALSE_WORDS.has(privateCell)) issues.push("private");

    return {
      issues,
      line: index + 2,
      row:
        issues.length === 0 && value !== null
          ? {
              currencyCode,
              isPrivate: TRUE_WORDS.has(privateCell),
              kind,
              name,
              value,
              ...(valuationDate ? { valuationDate } : {}),
            }
          : undefined,
    };
  });
  return { fileIssues: [], rows };
}
