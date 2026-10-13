import crypto from 'node:crypto';

import { sanitizeCategoryLabel, sanitizeTransactionEnrichmentText } from './privacy';

interface CategoryOption {
  categoryKey: number;
  label: string;
}

type Direction = 'credit' | 'debit' | 'unknown';

export function buildTransactionEnrichmentPrompt(input: {
  candidateText?: null | string;
  categories: CategoryOption[];
  direction: Direction;
  promptVersion: string;
}) {
  const sanitizedCandidateText = sanitizeTransactionEnrichmentText(input.candidateText) ?? null;
  const categoryOptions = input.categories.map((category) => ({ categoryKey: category.categoryKey, label: sanitizeCategoryLabel(category.label) ?? '' }));
  const outputContract = {
    reasonCodes: [
      'merchant_and_category_suggested',
      'merchant_suggested',
      'category_suggested',
      'ambiguous',
      'insufficient_safe_context',
      'no_suggestion',
    ],
    responseShape: {
      categorySuggestionKey: 'positive integer or null',
      confidence: 'number from 0 to 1',
      inputId: 'lowercase 64-hex string',
      merchantSuggestion: 'string length 2..80 or null',
      reasonCode: 'enum reasonCodes',
    },
  };
  const payload = { candidateText: sanitizedCandidateText, categories: categoryOptions, direction: input.direction, outputContract, promptVersion: input.promptVersion };
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const inputId = inputHash;
  const system = 'You are a transaction enrichment assistant. Return only valid JSON.';
  const user = JSON.stringify({ categoryOptions, inputId, outputContract, transaction: { candidateText: sanitizedCandidateText, direction: input.direction } });
  return { inputHash, inputId, system, temperature: 0 as const, user };
}
