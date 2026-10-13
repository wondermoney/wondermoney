import OpenAI from '@service/ai/openai';

import { parsePortfolioColumnMappingSuggestionJson, portfolioColumnMappingJsonSchema, type PortfolioColumnMappingSuggestion } from './portfolio-csv-column-mapping.schema';

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

  const { answer, completionTokens, promptTokens, tokens } = await OpenAI.promptWithText({
    feature: 'csvMapping',
    messages: [
      { content: 'You map portfolio CSV columns to WonderMoney portfolio import fields. Identify the real table header row and any footer rows, then return only valid JSON matching the schema.', role: 'system' },
      { content: JSON.stringify({ headers, rowShapes, sampleRows }), role: 'user' },
    ],
    model: 'gpt-5.4-nano',
    responseFormat: {
      json_schema: { name: 'portfolio_column_mapping', schema: portfolioColumnMappingJsonSchema, strict: true },
      type: 'json_schema',
    },
  });

  const trimmedAnswer = answer?.trim();
  if (!trimmedAnswer) throw new Error('portfolio column mapping response missing');

  let suggestion: PortfolioColumnMappingSuggestion;
  try {
    suggestion = parsePortfolioColumnMappingSuggestionJson(trimmedAnswer);
  } catch {
    throw new Error('portfolio column mapping invalid response');
  }

  return { suggestion, tokens: { completionTokens, promptTokens, totalTokens: tokens } };
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
