import { z } from 'zod';

/**
 * How to read one bank statement file: which row holds the column names, which column holds each
 * field, and how its dates and amounts are written. Columns are referenced by position, so a file
 * with blank or repeated column names still maps. Built by `suggestStatementMapping` (column
 * names, then the model), shown to the person in the import preview, and sent back with the import
 * as they confirmed or corrected it.
 */
const columnIndex = z.number().int().min(0).max(99);

export const statementDateFormats = ['DMY', 'MDY', 'YMD'] as const;
export type StatementDateFormat = (typeof statementDateFormats)[number];

export const statementColumnsSchema = z.object({
  /** Money in, when the file splits the amount into two columns. */
  credit: columnIndex.optional(),
  currency: columnIndex.optional(),
  date: columnIndex,
  /** Money out, when the file splits the amount into two columns. */
  debit: columnIndex.optional(),
  description: columnIndex,
  /** A debit/credit marker ("D"/"C", "Débito"/"Crédito") beside an unsigned amount. */
  direction: columnIndex.optional(),
  /** The signed amount, when the file has one column for it. */
  amount: columnIndex.optional(),
  balance: columnIndex.optional(),
  /** The bank's own id for the line, used to recognise it on a later import when it is unique. */
  reference: columnIndex.optional(),
}).strict();

export const statementMappingSchema = z.object({
  columns: statementColumnsSchema,
  dateFormat: z.enum(statementDateFormats),
  decimalSeparator: z.enum(['.', ',']),
  /** -1 when the file has no row of column names. */
  headerRowIndex: z.number().int().min(-1).max(200),
  /** Spending is written as a positive amount (credit-card statements). */
  invertAmounts: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  const { amount, credit, debit } = value.columns;
  if (amount === undefined && debit === undefined && credit === undefined) ctx.addIssue({ code: 'custom', message: 'An amount column, or money in and money out columns, is required', path: ['columns', 'amount'] });
});

export type StatementColumnField = keyof StatementColumns;
export type StatementColumns = z.infer<typeof statementColumnsSchema>;
export type StatementMapping = z.infer<typeof statementMappingSchema>;
