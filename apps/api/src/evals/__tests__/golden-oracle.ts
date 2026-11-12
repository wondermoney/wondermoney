/**
 * A fake model that answers from the golden sets: for each request it finds the item the prompt
 * was built from and replies with that item's expected answer, unless the item is listed in
 * `wrong`, where it replies with a deliberate mistake. Keeps the end-to-end eval test exact.
 */
import { findHeaderRow, readStatementGrid, statementMappingPromptInput } from '@service/account/account-statement-reader';
import { portfolioColumnMappingFields } from '@service/portfolio/portfolio-csv-column-mapping.schema';
import { sanitizeTransactionEnrichmentText } from '@service/transaction-enrichment/privacy';

import { ABSTAIN, type CategorizationDataset, type CsvMappingDataset } from '../datasets';

import type { FakeChatRequest } from './fake-openai-server';

interface EnrichmentPrompt {
  categoryOptions: { categoryKey: number; label: string }[];
  inputId: string;
  transaction: { candidateText: null | string };
}

export async function goldenOracle(categorization: CategorizationDataset, csvMapping: CsvMappingDataset, wrong: ReadonlySet<string> = new Set()) {
  // Items that send the same text share one answer, wrong when any of them is listed in `wrong`.
  const categoryByText = new Map<string, { expected: string; ids: string[] }>();
  for (const item of categorization.items) {
    const text = sanitizeTransactionEnrichmentText(item.merchant ?? item.description);
    if (!text) continue;
    const entry = categoryByText.get(text) ?? { expected: item.expected, ids: [] };
    entry.ids.push(item.id);
    categoryByText.set(text, entry);
  }

  const statementByShape = new Map<string, { answer: unknown; id: string }>();
  const portfolioByHeaders = new Map<string, { answer: unknown; id: string }>();
  for (const item of csvMapping.items) {
    if (item.kind === 'account') {
      const grid = await readStatementGrid(Buffer.from(item.csv, 'utf8'));
      const input = statementMappingPromptInput(grid, findHeaderRow(grid));
      const columns = Object.fromEntries(['date', 'description', 'amount', 'debit', 'credit', 'direction', 'currency', 'balance', 'reference'].map((field) => [field, item.expected.columns[field as keyof typeof item.expected.columns] ?? null]));
      statementByShape.set(statementKey(input.columns.map((column) => column.header), input.rowShapes), { answer: { columns, headerRowIndex: item.expected.headerRowIndex, spendingIsPositive: item.expected.spendingIsPositive }, id: item.id });
    } else {
      const headers = item.csv.split('\n')[0]?.split(',') ?? [];
      const mapping: Record<string, null | string> = Object.fromEntries(portfolioColumnMappingFields.map((field) => [field, item.expected.columnMapping[field] ?? null]));
      // The import reads "Total EUR" as a fixed currency only when the model maps the currency to it.
      if (item.expected.fixedCurrency) mapping['currency'] = item.expected.columnMapping.totalAmount ?? null;
      portfolioByHeaders.set(headers.join('|'), {
        answer: { columnMapping: mapping, confidence: 0.9, detectedBroker: null, layout: { dataStartRowIndex: 1, footerMatchers: null, footerRowCount: null, headerRowIndex: 0 }, transformations: { dateFormat: null, decimalSeparator: null, negativeAmountMeansBuy: null, quantitySignIndicatesDirection: null, thousandsSeparator: null }, warnings: [] },
        id: item.id,
      });
    }
  }

  return (request: FakeChatRequest): unknown => {
    const prompt = JSON.parse(request.user) as Record<string, unknown>;
    if (request.schemaName === 'transaction_enrichment') {
      const { categoryOptions, inputId, transaction } = prompt as unknown as EnrichmentPrompt;
      const golden = transaction.candidateText ? categoryByText.get(transaction.candidateText) : undefined;
      let label = golden && golden.expected !== ABSTAIN ? golden.expected : null;
      // A mistake: a wrong category on a categorisable item, a confident guess on an uncategorisable one.
      if (golden?.ids.some((id) => wrong.has(id))) label = label === 'GROCERIES' ? 'FUEL' : 'GROCERIES';
      const key = label === null ? null : (categoryOptions.find((option) => option.label === label)?.categoryKey ?? null);
      return { categorySuggestionKey: key, confidence: key === null ? 0.2 : 0.9, inputId, merchantSuggestion: null, reasonCode: key === null ? 'no_suggestion' : 'category_suggested' };
    }
    if (request.schemaName === 'statement_column_mapping') {
      const { columns, rowShapes } = prompt as { columns: { header: string }[]; rowShapes: string[] };
      const golden = statementByShape.get(statementKey(columns.map((column) => column.header), rowShapes));
      if (!golden) throw new Error('golden oracle: unknown statement');
      if (wrong.has(golden.id)) return { ...(golden.answer as object), spendingIsPositive: !(golden.answer as { spendingIsPositive: boolean }).spendingIsPositive };
      return golden.answer;
    }
    if (request.schemaName === 'portfolio_column_mapping') {
      const { headers } = prompt as { headers: string[] };
      const golden = portfolioByHeaders.get(headers.join('|'));
      if (!golden) throw new Error('golden oracle: unknown portfolio export');
      if (wrong.has(golden.id)) return { ...(golden.answer as object), columnMapping: { ...(golden.answer as { columnMapping: object }).columnMapping, quantity: null } };
      return golden.answer;
    }
    throw new Error(`golden oracle: unexpected schema ${request.schemaName ?? 'none'}`);
  };
}

function statementKey(headers: string[], rowShapes: string[]): string {
  return `${headers.join('|')}#${rowShapes.join('|')}`;
}
