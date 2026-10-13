import DeepSeek from '@service/ai/deepseek';

import { buildTransactionEnrichmentPrompt } from './prompt';
import { parseTransactionEnrichmentResponseJson, type TransactionEnrichmentResponse, transactionEnrichmentResponseJsonSchema } from './schema';

export interface TransactionEnrichmentDeepSeekInput {
  candidateText?: null | string;
  categories: { categoryKey: number; label: string }[];
  direction: 'credit' | 'debit' | 'unknown';
  modelVersion: string;
  promptVersion: string;
}

export interface TransactionEnrichmentDeepSeekResult {
  inputHash: string;
  inputId: string;
  modelVersion: string;
  promptVersion: string;
  result: TransactionEnrichmentResponse;
  tokens: { completionTokens: number; promptTokens: number; totalTokens: number };
}

export async function requestTransactionEnrichmentSuggestion(input: TransactionEnrichmentDeepSeekInput): Promise<TransactionEnrichmentDeepSeekResult> {
  const prompt = buildTransactionEnrichmentPrompt(input);
  const { answer, completionTokens, promptTokens, tokens } = await DeepSeek.promptWithText({
    messages: [
      { content: prompt.system, role: 'system' },
      { content: prompt.user, role: 'user' },
    ],
    model: input.modelVersion,
    responseFormat: {
      json_schema: { name: 'transaction_enrichment', schema: transactionEnrichmentResponseJsonSchema, strict: true },
      type: 'json_schema',
    },
    temperature: prompt.temperature,
  });

  const trimmedAnswer = answer?.trim();
  if (!trimmedAnswer) {
    throw new Error('transaction enrichment response missing');
  }

  let result: TransactionEnrichmentResponse;
  try {
    result = parseTransactionEnrichmentResponseJson(trimmedAnswer, prompt.inputId, input.categories.map((category) => category.categoryKey));
  } catch {
    throw new Error('transaction enrichment invalid response');
  }

  return {
    inputHash: prompt.inputHash,
    inputId: prompt.inputId,
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
    result,
    tokens: { completionTokens, promptTokens, totalTokens: tokens },
  };
}
