import type { StatementMapping } from "@/lib/api/account/usePreviewAccountCsvImport";

/** Whether a mapping names every column the import needs. */
export const isStatementMappingComplete = (
  mapping: StatementMapping | undefined,
): mapping is StatementMapping =>
  mapping !== undefined &&
  mapping.columns.date !== undefined &&
  mapping.columns.description !== undefined &&
  (mapping.columns.amount !== undefined ||
    mapping.columns.debit !== undefined ||
    mapping.columns.credit !== undefined);
