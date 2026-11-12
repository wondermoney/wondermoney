import { jsonSchema, type JSONSchema7 } from 'ai';
import { z } from 'zod';

import { completeJson, type CompleteJsonTokens } from '@service/ai/complete-json';

import type { StatementColumnField, StatementColumns } from './account-statement-mapping.schema';
import type { StatementColumnProfile } from './account-statement-reader';

/**
 * Asks the model which row holds the column names and which column holds each field, when the
 * names alone did not settle it. It sees the column names, the kinds of value in each column and the
 * shape of the first rows, never a description, an amount or a date from the file.
 */

export interface StatementMappingPromptInput {
  /** The first rows as cell kinds: D date, N number, T text, _ empty. */
  columns: StatementColumnProfile[];
  rowShapes: string[];
}

const FIELDS = ['date', 'description', 'amount', 'debit', 'credit', 'direction', 'currency', 'balance', 'reference'] as const satisfies readonly StatementColumnField[];

const answerSchema = z.object({
  columns: z.object(Object.fromEntries(FIELDS.map((field) => [field, z.number().int().min(0).max(99).nullable()])) as Record<(typeof FIELDS)[number], z.ZodNullable<z.ZodNumber>>),
  headerRowIndex: z.number().int().min(-1).max(200),
  spendingIsPositive: z.boolean(),
});

const STATEMENT_MAPPING_JSON_SCHEMA: JSONSchema7 = {
  additionalProperties: false,
  properties: {
    columns: {
      additionalProperties: false,
      properties: Object.fromEntries(FIELDS.map((field) => [field, { maximum: 99, minimum: 0, type: ['integer', 'null'] }])),
      required: [...FIELDS],
      type: 'object',
    },
    headerRowIndex: { maximum: 200, minimum: -1, type: 'integer' },
    spendingIsPositive: { type: 'boolean' },
  },
  required: ['columns', 'headerRowIndex', 'spendingIsPositive'],
  type: 'object',
};

const SYSTEM_PROMPT = [
  'You map the columns of a bank or credit-card statement export to transaction fields.',
  'You get the shape of the first rows (one letter per cell: D date, N number, T text, _ empty) and, for each column, its name from the header row and the share of its values that are dates, numbers, negative numbers or empty.',
  'Return the 0-based index of the row that holds the column names (-1 if there is none), and the 0-based column index for each field, or null.',
  'date: the booking or transaction date, not the value date when both exist. description: the text saying what the transaction was. amount: one signed amount column; or debit (money out) and credit (money in) when the file splits them.',
  'direction: a column marking each unsigned amount as debit or credit. balance: the running balance, never the amount. reference: the bank\'s id for the line.',
  'Every statement has a date, a description and either an amount or debit and credit columns: never leave all of amount, debit and credit null. Two number columns are usually the amount and the running balance.',
  'spendingIsPositive: true only when purchases are written as positive amounts and payments as negative, as on some credit-card statements.',
].join(' ');

export interface StatementMappingGuess {
  columns: Partial<StatementColumns>;
  headerRowIndex: number;
  spendingIsPositive: boolean;
  tokens: CompleteJsonTokens;
}

export async function requestStatementMapping(input: StatementMappingPromptInput): Promise<StatementMappingGuess> {
  const { object, tokens } = await completeJson({
    feature: 'csvMapping',
    schema: jsonSchema(STATEMENT_MAPPING_JSON_SCHEMA),
    schemaName: 'statement_column_mapping',
    system: SYSTEM_PROMPT,
    user: JSON.stringify(sanitize(input)),
    // The Azure deployment. Off Azure, `AI_MODEL_CSV_MAPPING` decides.
    azureDeployment: 'gpt-5.4-nano',
  });

  let parsed: z.infer<typeof answerSchema>;
  try {
    parsed = answerSchema.parse(object);
  } catch {
    throw new Error('statement mapping invalid response');
  }
  const columns: Partial<StatementColumns> = {};
  for (const field of FIELDS) {
    const index = parsed.columns[field];
    if (index !== null && index < input.columns.length) columns[field] = index;
  }
  return { columns, headerRowIndex: parsed.headerRowIndex, spendingIsPositive: parsed.spendingIsPositive, tokens };
}

function sanitize(input: StatementMappingPromptInput): StatementMappingPromptInput {
  return {
    columns: input.columns.slice(0, 40).map((column) => ({ ...column, header: column.header.slice(0, 80) })),
    rowShapes: input.rowShapes.slice(0, 15).map((shape) => shape.slice(0, 40)),
  };
}
