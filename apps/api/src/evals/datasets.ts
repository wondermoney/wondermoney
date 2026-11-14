/**
 * The golden sets the LLM evals score against, and their schemas.
 *
 * The data lives in `apps/api/evals/data` (JSON, synthetic only) and the thresholds in
 * `apps/api/evals/thresholds.json`, next to the source tree rather than inside it, so neither is
 * compiled into `dist` or read by anything but the eval runner and its schema test.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** `apps/api/evals`, from `src/evals` here and from `dist/evals` once compiled. */
export const EVALS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../evals');

export const DATASET_NAMES = ['categorization', 'csv-mapping'] as const;
export type DatasetName = (typeof DATASET_NAMES)[number];

export const DATASET_FILES: Record<DatasetName, string> = {
  categorization: 'data/categorization.v1.json',
  'csv-mapping': 'data/csv-mapping.v1.json',
};

/** What a categorization item expects when no category can be known from its description. */
export const ABSTAIN = 'abstain';

const language = z.enum(['de', 'en', 'es', 'fr', 'pt']);

export const categorizationItemSchema = z.object({
  amount: z.number().refine((value) => value !== 0, 'amount must not be zero'),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().min(1).max(120),
  direction: z.enum(['credit', 'debit']),
  /** A name from the dataset's `categories`, or `abstain`. */
  expected: z.string().min(1),
  id: z.string().regex(/^[a-z]{2}-\d{3}$/),
  language,
  /** The merchant name a bank sync attaches, when there is one; production sends it in place of the description. */
  merchant: z.string().min(2).max(80).optional(),
}).strict().refine((item) => (item.direction === 'credit') === (item.amount > 0), 'direction must match the sign of amount');

export const categorizationDatasetSchema = z.object({
  /** The candidate categories, in the order their keys (1, 2, ...) are assigned. */
  categories: z.array(z.string().regex(/^[A-Z_]+$/)).min(2),
  description: z.string(),
  items: z.array(categorizationItemSchema).min(1),
  version: z.literal(1),
}).strict().superRefine((dataset, ctx) => {
  const categories = new Set(dataset.categories);
  if (categories.size !== dataset.categories.length) ctx.addIssue({ code: 'custom', message: 'categories must be unique', path: ['categories'] });
  const ids = new Set<string>();
  dataset.items.forEach((item, index) => {
    if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${item.id}`, path: ['items', index, 'id'] });
    ids.add(item.id);
    if (item.expected !== ABSTAIN && !categories.has(item.expected)) ctx.addIssue({ code: 'custom', message: `unknown category ${item.expected}`, path: ['items', index, 'expected'] });
  });
});

const accountField = z.enum(['date', 'description', 'amount', 'debit', 'credit', 'direction', 'currency', 'balance', 'reference']);
const portfolioField = z.enum(['transactionDate', 'transactionType', 'assetName', 'isin', 'ticker', 'brokerExchange', 'quantity', 'unitPrice', 'totalAmount', 'currency', 'feeAmount', 'externalTransactionId']);

const csvItemBase = {
  csv: z.string().min(1),
  id: z.string().regex(/^[a-z]+-\d{2}$/),
  language,
  note: z.string().min(1),
};

export const accountCsvItemSchema = z.object({
  ...csvItemBase,
  expected: z.object({
    columns: z.partialRecord(accountField, z.number().int().min(0).max(99)),
    headerRowIndex: z.number().int().min(-1),
    spendingIsPositive: z.boolean(),
  }).strict(),
  kind: z.literal('account'),
}).strict();

export const portfolioCsvItemSchema = z.object({
  ...csvItemBase,
  expected: z.object({
    columnMapping: z.partialRecord(portfolioField, z.string().min(1)),
    /** A currency the import reads from a value column's name ("Total EUR") instead of a column. */
    fixedCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  }).strict(),
  kind: z.literal('portfolio'),
}).strict();

export const csvMappingItemSchema = z.discriminatedUnion('kind', [accountCsvItemSchema, portfolioCsvItemSchema]);

export const csvMappingDatasetSchema = z.object({
  description: z.string(),
  items: z.array(csvMappingItemSchema).min(1),
  version: z.literal(1),
}).strict().superRefine((dataset, ctx) => {
  const ids = new Set<string>();
  dataset.items.forEach((item, index) => {
    if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${item.id}`, path: ['items', index, 'id'] });
    ids.add(item.id);
  });
});

const bounds = z.object({
  max: z.record(z.string(), z.number()).optional(),
  min: z.record(z.string(), z.number()).optional(),
}).strict();

/** Per scored section (`categorization.llm`, `categorization.bayes`, `csvMapping`), the bounds its metrics must stay within. */
export const thresholdsSchema = z.object({
  categorization: z.object({ bayes: bounds, llm: bounds }).strict(),
  csvMapping: bounds,
}).strict();

export type AccountCsvItem = z.infer<typeof accountCsvItemSchema>;
export type CategorizationDataset = z.infer<typeof categorizationDatasetSchema>;
export type CategorizationItem = z.infer<typeof categorizationItemSchema>;
export type CsvMappingDataset = z.infer<typeof csvMappingDatasetSchema>;
export type CsvMappingItem = z.infer<typeof csvMappingItemSchema>;
export type MetricBounds = z.infer<typeof bounds>;
export type PortfolioCsvItem = z.infer<typeof portfolioCsvItemSchema>;
export type Thresholds = z.infer<typeof thresholdsSchema>;

export async function loadCategorizationDataset(dir = EVALS_DIR): Promise<CategorizationDataset> {
  return categorizationDatasetSchema.parse(await readJson(path.join(dir, DATASET_FILES.categorization)));
}

export async function loadCsvMappingDataset(dir = EVALS_DIR): Promise<CsvMappingDataset> {
  return csvMappingDatasetSchema.parse(await readJson(path.join(dir, DATASET_FILES['csv-mapping'])));
}

export async function loadThresholds(file = path.join(EVALS_DIR, 'thresholds.json')): Promise<Thresholds> {
  return thresholdsSchema.parse(await readJson(file));
}

/**
 * Up to `limit` items spread evenly over the set, so a quick run still sees every language and
 * kind (the files are grouped by language). No limit, or one at least the set's size, is all.
 */
export function selectItems<T>(items: readonly T[], limit?: number): T[] {
  if (limit === undefined || limit >= items.length) return [...items];
  if (limit <= 0) return [];
  return Array.from({ length: limit }, (_, index) => items[Math.floor((index * items.length) / limit)] as T);
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}
