import Papa from "papaparse";

import type { TransactionType } from "@/lib/api/account/useTransactionTypes";

/**
 * The generic CSV format the API reads for an account whose bank has no statement parser
 * (`AccountCsvImportService.importAccountCsv` without a bank name). The header names are fixed
 * and no other column is accepted, so the template carries exactly these.
 */
export const GENERIC_CSV_COLUMNS = [
  "date",
  "amount",
  "merchant",
  "internalTransactionId",
  "transactionTypeKey",
  "description",
] as const;

export type GenericCsvColumn = (typeof GENERIC_CSV_COLUMNS)[number];

export const GENERIC_CSV_OPTIONAL_COLUMNS: ReadonlySet<GenericCsvColumn> =
  new Set<GenericCsvColumn>(["description"]);

export const GENERIC_CSV_TEMPLATE_FILENAME = "transactions-template.csv";

/**
 * A template with the header and, when the account's transaction types are known, one money-out
 * and one money-in example row using their real type codes.
 */
export function buildGenericCsvTemplate(
  transactionTypes: TransactionType[] = [],
): string {
  const keyOf = (name: string) =>
    transactionTypes.find((type) => type.name === name)?.transactionTypeKey;
  const examples: Record<GenericCsvColumn, string>[] = [];
  const payment = keyOf("PAYMENT");
  const deposit = keyOf("DEPOSIT");
  if (payment !== undefined) {
    examples.push({
      date: "2026-01-15",
      amount: "23.40",
      merchant: "Grocery store",
      internalTransactionId: "example-1",
      transactionTypeKey: String(payment),
      description: "Weekly shop",
    });
  }
  if (deposit !== undefined) {
    examples.push({
      date: "2026-01-31",
      amount: "1500.00",
      merchant: "Employer",
      internalTransactionId: "example-2",
      transactionTypeKey: String(deposit),
      description: "Salary",
    });
  }
  return Papa.unparse(
    {
      fields: [...GENERIC_CSV_COLUMNS],
      data: examples.map((row) =>
        GENERIC_CSV_COLUMNS.map((column) => row[column]),
      ),
    },
    { newline: "\n" },
  );
}
