import { jsonSchema } from 'ai';

import { AiCompletionError, completeJson } from '@service/ai/complete-json';
import { FeatureDisabledError } from '@utils/errors';

import { parsePortfolioColumnMappingSuggestion, portfolioColumnMappingJsonSchema, type PortfolioColumnMappingSuggestion } from './portfolio-csv-column-mapping.schema';

export interface PortfolioCsvColumnMappingOpenAIInput {
  headers: string[];
  rowShapes: { cellCount: number; emptyCellCount: number; nonEmptyCellCount: number }[];
  sampleRows: { emptyCellCount: number; hasNumericCells: boolean; hasTextCells: boolean; headerCount: number; nonEmptyCellCount: number; rowIndex: number; }[];
}

export interface PortfolioCsvColumnMappingOpenAIResult {
  suggestion: PortfolioColumnMappingSuggestion;
  tokens: { completionTokens: number; promptTokens: number; totalTokens: number };
}

const MAX_HEADERS = 40;
const MAX_HEADER_LENGTH = 80;
const MAX_SAMPLE_ROWS = 5;

export async function requestPortfolioColumnMappingSuggestion(input: PortfolioCsvColumnMappingOpenAIInput): Promise<PortfolioCsvColumnMappingOpenAIResult> {
  const { headers, rowShapes, sampleRows } = sanitizePortfolioColumnMappingPromptInput(input);

  let object: unknown;
  let tokens: { completionTokens: number; promptTokens: number; totalTokens: number };
  try {
    const completion = await completeJson({
      feature: 'csvMapping',
      schema: jsonSchema(portfolioColumnMappingJsonSchema),
      schemaName: 'portfolio_column_mapping',
      system: 'You map portfolio CSV columns to WonderMoney portfolio import fields. Identify the real table header row and any footer rows, then return only valid JSON matching the schema.',
      user: JSON.stringify({ headers, rowShapes, sampleRows }),
      // The Azure deployment. Off Azure, `AI_MODEL_CSV_MAPPING` decides.
      azureDeployment: 'gpt-5.4-nano',
    });
    object = completion.object;
    tokens = completion.tokens;
  } catch (error) {
    if (error instanceof FeatureDisabledError) throw error;
    if (error instanceof AiCompletionError && error.empty) throw new Error('portfolio column mapping response missing');
    throw new Error('portfolio column mapping invalid response');
  }

  let suggestion: PortfolioColumnMappingSuggestion;
  try {
    suggestion = parsePortfolioColumnMappingSuggestion(object);
  } catch {
    throw new Error('portfolio column mapping invalid response');
  }

  return { suggestion, tokens: { completionTokens: tokens.completionTokens, promptTokens: tokens.promptTokens, totalTokens: tokens.totalTokens } };
}

export function sanitizePortfolioColumnMappingPromptInput(input: PortfolioCsvColumnMappingOpenAIInput): PortfolioCsvColumnMappingOpenAIInput {
  const headers = input.headers.slice(0, MAX_HEADERS).map((header) => truncateString(header, MAX_HEADER_LENGTH));
  const rowShapes = input.rowShapes.slice(0, 12).map((rowShape) => ({ cellCount: rowShape.cellCount, emptyCellCount: rowShape.emptyCellCount, nonEmptyCellCount: rowShape.nonEmptyCellCount }));
  const sampleRows = input.sampleRows.slice(0, MAX_SAMPLE_ROWS).map((row) => ({ emptyCellCount: row.emptyCellCount, hasNumericCells: row.hasNumericCells, hasTextCells: row.hasTextCells, headerCount: row.headerCount, nonEmptyCellCount: row.nonEmptyCellCount, rowIndex: row.rowIndex }));
  return { headers, rowShapes, sampleRows };
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
