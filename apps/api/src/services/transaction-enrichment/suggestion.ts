import { jsonSchema } from 'ai';

import { AiCompletionError, completeJson } from '@service/ai/complete-json';
import { FeatureDisabledError } from '@utils/errors';

import { buildTransactionEnrichmentPrompt } from './prompt';
import { parseTransactionEnrichmentResponse, type TransactionEnrichmentResponse, transactionEnrichmentResponseJsonSchema } from './schema';

export interface TransactionEnrichmentSuggestionInput {
  candidateText?: null | string;
  categories: { categoryKey: number; label: string }[];
  direction: 'credit' | 'debit' | 'unknown';
  modelVersion: string;
  promptVersion: string;
}

export interface TransactionEnrichmentSuggestionResult {
  inputHash: string;
  inputId: string;
  modelVersion: string;
  promptVersion: string;
  result: TransactionEnrichmentResponse;
  tokens: { completionTokens: number; promptTokens: number; totalTokens: number };
}

const ENRICHMENT_SCHEMA = jsonSchema(transactionEnrichmentResponseJsonSchema);

/**
 * Asks the configured model for a category and merchant suggestion. The response is validated
 * again here, not just by the model, because the echoed `inputId`, the category whitelist and the
 * merchant sanitizer are ours to enforce.
 */
export async function requestTransactionEnrichmentSuggestion(input: TransactionEnrichmentSuggestionInput): Promise<TransactionEnrichmentSuggestionResult> {
  const prompt = buildTransactionEnrichmentPrompt(input);

  let object: unknown;
  let tokens: { completionTokens: number; promptTokens: number; totalTokens: number };
  try {
    const completion = await completeJson({
      feature: 'enrichment',
      schema: ENRICHMENT_SCHEMA,
      schemaName: 'transaction_enrichment',
      system: prompt.system,
      temperature: prompt.temperature,
      user: prompt.user,
      // Foundry names the model per call; the compatible and Anthropic routes use AI_MODEL.
      model: input.modelVersion,
    });
    object = completion.object;
    tokens = completion.tokens;
  } catch (error) {
    if (error instanceof FeatureDisabledError) throw error;
    // A transport failure keeps its status: the worker retries 429/5xx through pg-boss.
    if (error instanceof AiCompletionError && error.status !== undefined) throw error;
    if (error instanceof AiCompletionError && error.empty) throw new Error('transaction enrichment response missing');
    throw new Error('transaction enrichment invalid response');
  }

  let result: TransactionEnrichmentResponse;
  try {
    result = parseTransactionEnrichmentResponse(object, prompt.inputId, input.categories.map((category) => category.categoryKey));
  } catch {
    throw new Error('transaction enrichment invalid response');
  }

  return {
    inputHash: prompt.inputHash,
    inputId: prompt.inputId,
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
    result,
    tokens: { completionTokens: tokens.completionTokens, promptTokens: tokens.promptTokens, totalTokens: tokens.totalTokens },
  };
}
