/**
 * Categorization evals: the AI enrichment pipeline and the local Bayes categorizer, scored on the
 * same golden items.
 *
 * Both run as production runs them. The AI path skips what the enqueue filter skips (withdrawals
 * and transfers), sends what the worker sends (the merchant name, else the description, and the
 * direction from the amount's sign) through `requestTransactionEnrichmentSuggestion` (the
 * production prompt, model call and response parser), and keeps only what write mode would write
 * (`write-guardrail.ts`). The candidate categories are the dataset's, which mirror the system
 * categories a household without its own correction history is offered.
 */
import { buildTransactionEnrichmentConfig } from '@app/jobs/transaction-enrichment.config';
import { isUncategorisableByDescription } from '@service/transaction-enrichment/enrichment-eligibility';
import { sanitizeTransactionEnrichmentText } from '@service/transaction-enrichment/privacy';
import { requestTransactionEnrichmentSuggestion } from '@service/transaction-enrichment/suggestion';
import { clearsWriteThreshold, isUninformativeCategory } from '@service/transaction-enrichment/write-guardrail';
import { type BayesFeatureInput, type BayesModel, bayesThresholds, type BayesTrainingSample, decideBayes, scoreBayes, trainBayesModel } from '@service/transaction/bayes-categorizer';
import { FeatureDisabledError } from '@utils/errors';

import { mapWithConcurrency } from './concurrency';
import { ABSTAIN, type CategorizationDataset, type CategorizationItem } from './datasets';
import { type CategorizationOutcome } from './metrics';

export interface CategorizationItemResult extends CategorizationOutcome {
  confidence?: number;
  errorMessage?: string;
  id: string;
  language: string;
  reasonCode?: string;
  /** The model's raw category before write mode's guardrails, for diagnosing a miss. */
  suggested?: null | string;
  /** True when the privacy filter withheld the text, so the model was asked with none. */
  textWithheld?: boolean;
}

/** Folds for the Bayes cross-validation: each item is scored by a model trained on the other folds. */
const BAYES_FOLDS = 5;

interface CategoryIndex {
  keyOf: Map<string, number>;
  labelOf: Map<number, string>;
  options: { categoryKey: number; label: string }[];
}

function categoryIndex(dataset: CategorizationDataset): CategoryIndex {
  const options = dataset.categories.map((label, index) => ({ categoryKey: index + 1, label }));
  return {
    keyOf: new Map(options.map((option) => [option.label, option.categoryKey])),
    labelOf: new Map(options.map((option) => [option.categoryKey, option.label])),
    options,
  };
}

/** True when production's enqueue filter keeps the item away from every categorizer. */
export function isFilteredByEligibility(item: CategorizationItem): boolean {
  return isUncategorisableByDescription({ description: item.description });
}

export async function runLlmCategorization(
  dataset: CategorizationDataset,
  items: readonly CategorizationItem[],
  options: { concurrency: number },
): Promise<CategorizationItemResult[]> {
  const config = buildTransactionEnrichmentConfig();
  const categories = categoryIndex(dataset);

  return mapWithConcurrency(items, options.concurrency, async (item) => {
    const base = { calledModel: false, error: false, expected: expectedOf(item), id: item.id, language: item.language, predicted: null, tokens: 0 };
    if (isFilteredByEligibility(item)) return base;
    const candidateText = item.merchant ?? item.description;
    // The prompt builder applies this filter itself; it is repeated only to report what was withheld.
    const textWithheld = sanitizeTransactionEnrichmentText(candidateText) === undefined;
    try {
      const suggestion = await requestTransactionEnrichmentSuggestion({
        candidateText,
        categories: categories.options,
        direction: item.amount > 0 ? 'credit' : 'debit',
        modelVersion: config.modelVersion,
        promptVersion: config.promptVersion,
      });
      const { result } = suggestion;
      const suggested = result.categorySuggestionKey === null ? null : (categories.labelOf.get(result.categorySuggestionKey) ?? null);
      const writable = clearsWriteThreshold(result, config.writeConfidenceThreshold) && suggested !== null && !isUninformativeCategory({ isSystemCategory: true, name: suggested });
      return { ...base, calledModel: true, confidence: result.confidence, predicted: writable ? suggested : null, reasonCode: result.reasonCode, suggested, textWithheld, tokens: suggestion.tokens.totalTokens };
    } catch (error) {
      if (error instanceof FeatureDisabledError) throw error;
      return { ...base, calledModel: true, error: true, errorMessage: error instanceof Error ? error.message : String(error), textWithheld };
    }
  });
}

/**
 * The Bayes categorizer has no global model: production trains one per person on their own
 * confirmed history. Here every item is scored by a model trained on the other folds of the whole
 * set (items the eligibility filter drops and uncategorisable ones never train it, as in
 * `loadBayesTrainingSamples`), so `--limit` changes which items are scored, not what trains them.
 */
export function runBayesCategorization(
  dataset: CategorizationDataset,
  items: readonly CategorizationItem[],
  env: Partial<Record<string, string | undefined>> = process.env,
): CategorizationItemResult[] {
  const categories = categoryIndex(dataset);
  const merchantKeys = new Map<string, number>();
  const features = (item: CategorizationItem): BayesFeatureInput => ({
    accountKey: null,
    amount: item.amount,
    description: item.description,
    direction: item.amount >= 0 ? 'in' : 'out',
    merchantKey: item.merchant === undefined ? null : merchantKey(merchantKeys, item.merchant),
  });
  const foldOf = new Map(dataset.items.map((item, index) => [item.id, index % BAYES_FOLDS]));
  const models = new Map<number, BayesModel | null>();
  for (let fold = 0; fold < BAYES_FOLDS; fold += 1) {
    const training: BayesTrainingSample[] = dataset.items
      .filter((item) => foldOf.get(item.id) !== fold && item.expected !== ABSTAIN && !isFilteredByEligibility(item))
      .map((item) => ({ ...features(item), categoryKey: categories.keyOf.get(item.expected) ?? 0 }));
    models.set(fold, trainBayesModel(training));
  }
  const thresholds = bayesThresholds(env);

  return items.map((item) => {
    const base = { calledModel: false, error: false, expected: expectedOf(item), id: item.id, language: item.language, predicted: null, tokens: 0 };
    const model = models.get(foldOf.get(item.id) ?? 0);
    if (!model || isFilteredByEligibility(item)) return base;
    const decision = decideBayes(scoreBayes(model, features(item)), thresholds);
    return { ...base, confidence: decision?.posterior, predicted: decision ? (categories.labelOf.get(decision.categoryKey) ?? null) : null };
  });
}

function expectedOf(item: CategorizationItem): null | string {
  return item.expected === ABSTAIN ? null : item.expected;
}

function merchantKey(keys: Map<string, number>, name: string): number {
  const normalized = name.trim().toLowerCase();
  let key = keys.get(normalized);
  if (key === undefined) {
    key = keys.size + 1;
    keys.set(normalized, key);
  }
  return key;
}
