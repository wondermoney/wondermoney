/**
 * CSV column-mapping evals: the model's mapping of a bank statement or broker export, compared
 * with the expected one.
 *
 * Each file is read the way the import reads it and handed to the production request function,
 * which builds the prompt, calls the model and parses the answer: `requestStatementMapping` for a
 * statement, `requestPortfolioColumnMappingSuggestion` (then the import's normalization) for a
 * broker export. The eval always asks the model, including for files whose column names alone
 * would have settled the mapping in production, because the prompt is what it measures.
 */
import { requestStatementMapping } from '@service/account/account-statement-mapping-openai';
import { findHeaderRow, readStatementGrid, statementMappingPromptInput } from '@service/account/account-statement-reader';
import { parseCsvRows } from '@service/account/csv-upload-boundary.service';
import { requestPortfolioColumnMappingSuggestion, sanitizePortfolioColumnMappingPromptInput } from '@service/portfolio/portfolio-csv-column-mapping-openai';
import { portfolioColumnMappingFields } from '@service/portfolio/portfolio-csv-column-mapping.schema';
import { buildPortfolioColumnMappingPromptInput, normalizePortfolioColumnMappingSuggestion } from '@service/portfolio/portfolio-csv-column-mapping.utils';
import { parseRawCsvRowsForLayout } from '@service/portfolio/portfolio-csv-layout.utils';
import { FeatureDisabledError } from '@utils/errors';

import { mapWithConcurrency } from './concurrency';
import type { AccountCsvItem, CsvMappingItem, PortfolioCsvItem } from './datasets';
import { compareMappings, type CsvMappingOutcome } from './metrics';

export interface CsvMappingItemResult extends CsvMappingOutcome {
  actual?: Record<string, unknown>;
  errorMessage?: string;
  id: string;
  language: string;
  /** Fields whose answer differed from the expected one. */
  mismatched: string[];
}

const ACCOUNT_COMPARED_FIELDS = ['headerRowIndex', 'spendingIsPositive', 'date', 'description', 'amount', 'debit', 'credit', 'direction', 'currency', 'balance', 'reference'] as const;
const PORTFOLIO_COMPARED_FIELDS = [...portfolioColumnMappingFields, 'fixedCurrency'] as const;

export async function runCsvMapping(items: readonly CsvMappingItem[], options: { concurrency: number }): Promise<CsvMappingItemResult[]> {
  return mapWithConcurrency(items, options.concurrency, async (item) => {
    const fields = item.kind === 'account' ? ACCOUNT_COMPARED_FIELDS : PORTFOLIO_COMPARED_FIELDS;
    const expected = item.kind === 'account' ? expectedAccount(item) : expectedPortfolio(item);
    try {
      const { actual, tokens } = item.kind === 'account' ? await mapAccount(item) : await mapPortfolio(item);
      const comparison = compareMappings(expected, actual, fields);
      return { actual, error: false, exactMatch: comparison.mismatched.length === 0, fieldsCorrect: comparison.fieldsCorrect, fieldsTotal: comparison.fieldsTotal, id: item.id, kind: item.kind, language: item.language, mismatched: comparison.mismatched, tokens };
    } catch (error) {
      if (error instanceof FeatureDisabledError) throw error;
      return { error: true, errorMessage: error instanceof Error ? error.message : String(error), exactMatch: false, fieldsCorrect: 0, fieldsTotal: fields.length, id: item.id, kind: item.kind, language: item.language, mismatched: [...fields], tokens: 0 };
    }
  });
}

function expectedAccount(item: AccountCsvItem): Record<string, unknown> {
  return { ...item.expected.columns, headerRowIndex: item.expected.headerRowIndex, spendingIsPositive: item.expected.spendingIsPositive };
}

function expectedPortfolio(item: PortfolioCsvItem): Record<string, unknown> {
  return { ...item.expected.columnMapping, fixedCurrency: item.expected.fixedCurrency };
}

/** As `detectStatement` asks the model: the header row the names point at, and that row's column profiles. */
async function mapAccount(item: AccountCsvItem) {
  const grid = await readStatementGrid(Buffer.from(item.csv, 'utf8'));
  const guess = await requestStatementMapping(statementMappingPromptInput(grid, findHeaderRow(grid)));
  return { actual: { ...guess.columns, headerRowIndex: guess.headerRowIndex, spendingIsPositive: guess.spendingIsPositive }, tokens: guess.tokens.totalTokens };
}

/** As `suggestColumnMapping` asks the model, with the suggestion normalized the way the import shows it. */
async function mapPortfolio(item: PortfolioCsvItem) {
  const rawRows = parseRawCsvRowsForLayout(item.csv);
  let rows: Record<string, string>[] = [];
  try { rows = parseCsvRows<Record<string, string>>(item.csv); } catch { rows = []; }
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const { suggestion, tokens } = await requestPortfolioColumnMappingSuggestion(sanitizePortfolioColumnMappingPromptInput(buildPortfolioColumnMappingPromptInput({ rawRows, rows })));
  const normalized = normalizePortfolioColumnMappingSuggestion(suggestion, headers);
  return { actual: { ...normalized.columnMapping, fixedCurrency: normalized.fixedValues.currency }, tokens: tokens.totalTokens };
}
