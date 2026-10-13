/**
 * Estimated DeepSeek-V4-Flash token pricing, expressed in USD per 1,000 tokens.
 *
 * These are approximations used only to populate `transaction_enrichment.estimated_cost_usd`
 * for observability/budgeting — they are NOT billed and are not authoritative. DeepSeek's
 * published rates are per-1M tokens; the values below are those public rates divided by 1,000
 * (input ≈ $0.27/1M, output ≈ $1.10/1M). Revisit if the deployed rate card changes.
 */
const PROMPT_USD_PER_1K = 0.00027;
const COMPLETION_USD_PER_1K = 0.0011;
const COST_DECIMALS = 8;

export function estimateTransactionEnrichmentCostUsd(promptTokens: number, completionTokens: number): number {
  const safePromptTokens = Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : 0;
  const safeCompletionTokens = Number.isFinite(completionTokens) && completionTokens > 0 ? completionTokens : 0;
  const cost = (safePromptTokens / 1000) * PROMPT_USD_PER_1K + (safeCompletionTokens / 1000) * COMPLETION_USD_PER_1K;
  return Number(cost.toFixed(COST_DECIMALS));
}
