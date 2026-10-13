import { z } from 'zod';

import { sanitizeMerchantSuggestion } from './privacy';

export const transactionEnrichmentReasonCodes = [
  'merchant_and_category_suggested',
  'merchant_suggested',
  'category_suggested',
  'ambiguous',
  'insufficient_safe_context',
  'no_suggestion',
] as const;

export const transactionEnrichmentResponseSchema = z.object({
  categorySuggestionKey: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1),
  inputId: z.string().regex(/^[a-f0-9]{64}$/),
  merchantSuggestion: z.string().min(2).max(80).nullable(),
  reasonCode: z.enum(transactionEnrichmentReasonCodes),
}).strict();

export const transactionEnrichmentResponseJsonSchema = {
  additionalProperties: false,
  properties: {
    categorySuggestionKey: { anyOf: [{ minimum: 1, type: 'integer' }, { type: 'null' }] },
    confidence: { maximum: 1, minimum: 0, type: 'number' },
    inputId: { pattern: '^[a-f0-9]{64}$', type: 'string' },
    merchantSuggestion: { anyOf: [{ maxLength: 80, minLength: 2, type: 'string' }, { type: 'null' }] },
    reasonCode: { enum: [...transactionEnrichmentReasonCodes], type: 'string' },
  },
  required: ['inputId', 'merchantSuggestion', 'categorySuggestionKey', 'confidence', 'reasonCode'],
  type: 'object',
} as const;

export type TransactionEnrichmentResponse = z.infer<typeof transactionEnrichmentResponseSchema>;

export function parseTransactionEnrichmentResponse(input: unknown, expectedInputId: string, allowedCategoryKeys: readonly number[]) {
  const parsed = transactionEnrichmentResponseSchema.parse(input);
  if (parsed.inputId !== expectedInputId) throw new Error('transaction enrichment input mismatch');
  if (parsed.categorySuggestionKey !== null && !allowedCategoryKeys.includes(parsed.categorySuggestionKey)) throw new Error('transaction enrichment invalid category');
  if (parsed.merchantSuggestion !== null && sanitizeMerchantSuggestion(parsed.merchantSuggestion) !== parsed.merchantSuggestion) throw new Error('transaction enrichment unsafe merchant suggestion');
  return parsed;
}

export function parseTransactionEnrichmentResponseJson(value: string, expectedInputId: string, allowedCategoryKeys: readonly number[]) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('transaction enrichment malformed json');
  }
  return parseTransactionEnrichmentResponse(parsed, expectedInputId, allowedCategoryKeys);
}
