import { useMutation } from "@tanstack/react-query";

import api from "../api";

/** Which column holds each field, by position, and how its dates and amounts are written. */
export interface StatementColumns {
  date?: number;
  description?: number;
  amount?: number;
  debit?: number;
  credit?: number;
  direction?: number;
  currency?: number;
  balance?: number;
  reference?: number;
}

export interface StatementMapping {
  columns: StatementColumns;
  dateFormat: "DMY" | "MDY" | "YMD";
  decimalSeparator: "." | ",";
  headerRowIndex: number;
  invertAmounts: boolean;
}

/**
 * How the file was read: by the bank's own parser, by its column names, by
 * the model, with the columns the person picked, or not at all (`none`, when
 * the person has to pick them).
 */
export type StatementSource = "bank" | "columns" | "model" | "person" | "none";

export interface StatementPreview {
  ambiguousDateFormat: boolean;
  bankName?: string;
  firstDate?: string;
  headers: string[];
  invalidRows: number;
  lastDate?: string;
  /** Absent when the bank's parser read the file. Incomplete when `source` is `none`. */
  mapping?: StatementMapping;
  sample: {
    amount: number;
    currency: string;
    date: string;
    description: string;
  }[];
  source: StatementSource;
  totalRows: number;
}

export interface PreviewAccountCsvImportRequest {
  accountId: string | number;
  key: string;
  mapping?: StatementMapping;
}

const usePreviewAccountCsvImport = () =>
  useMutation({
    mutationFn: ({ accountId, key, mapping }: PreviewAccountCsvImportRequest) =>
      api.post<StatementPreview>(
        `/v1/account/${accountId}/transaction/import/preview`,
        { key, ...(mapping ? { mapping } : {}) },
      ),
  });

export default usePreviewAccountCsvImport;
