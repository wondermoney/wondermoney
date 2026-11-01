import type { JobWithMetadata } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import {
  buildTransactionEnrichmentConfig,
  type TransactionEnrichmentConfig,
} from '@app/jobs/transaction-enrichment.config';
import {
  parseTransactionEnrichmentGptPayload,
  TRANSACTION_ENRICHMENT_GPT_QUEUE,
} from '@app/jobs/transaction-enrichment.queue';
import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source as AppuserTransactionCategorySource } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Tenant } from '@entity/Tenant';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { TransactionCategoryStats, Source as TransactionCategoryStatsSource } from '@entity/TransactionCategoryStats';
import { TransactionEnrichment, TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';
import { estimateTransactionEnrichmentCostUsd } from '@service/transaction-enrichment/cost';
import { requestTransactionEnrichmentSuggestion } from '@service/transaction-enrichment/deepseek';
import { reserveTransactionEnrichmentBudget } from '@service/transaction-enrichment/transaction-enrichment-budget.service';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

const TERMINAL_STATUSES: readonly TransactionEnrichmentStatus[] = [
  TransactionEnrichmentStatus.COMPLETED,
  TransactionEnrichmentStatus.DLQ,
  TransactionEnrichmentStatus.FAILED,
  TransactionEnrichmentStatus.SHADOW,
  TransactionEnrichmentStatus.SKIPPED,
];

interface TransactionEnrichmentWorkerDependencies {
  config?: TransactionEnrichmentConfig;
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
  requestSuggestion?: typeof requestTransactionEnrichmentSuggestion;
  reserveBudget?: typeof reserveTransactionEnrichmentBudget;
}

/**
 * Worker for the DeepSeek transaction-enrichment pipeline.
 *
 * Runs post-sync/non-critical. Fail-safe and idempotent: the ONLY path that triggers a pg-boss
 * retry is a `throw` on a transient transport error (429 / >=500); every other outcome returns a
 * boolean and consumes the job. Gated by a single kill switch (`enabled`). In `write` mode it applies
 * a confident suggestion to a still-uncategorized transaction (marked `ai_suggested`, left for the
 * user to confirm); in `shadow` mode it records the suggestion and applies nothing. No prompt/response
 * text or PII is ever logged.
 */
export async function handleTransactionEnrichmentGptJob(
  job: JobWithMetadata<unknown>,
  dependencies: TransactionEnrichmentWorkerDependencies = {},
): Promise<boolean> {
  const log = dependencies.logger ?? logger;
  const now = dependencies.now ?? (() => new Date());

  let payload;
  try {
    payload = parseTransactionEnrichmentGptPayload(job.data);
  } catch {
    log.warn({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE }, 'Transaction enrichment job payload is invalid');
    return false;
  }

  const config = dependencies.config ?? buildTransactionEnrichmentConfig();
  if (!config.enabled || config.mode === 'off') {
    log.info({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE }, 'Transaction enrichment pipeline is off; consuming job');
    return true;
  }

  const em = DI.em;
  const requestSuggestion = dependencies.requestSuggestion ?? requestTransactionEnrichmentSuggestion;
  const reserveBudget = dependencies.reserveBudget ?? reserveTransactionEnrichmentBudget;

  // One try/catch guards ALL DB + model work. Only a genuine transient transport failure
  // (DeepSeekHttpError 429/>=500) rethrows to trigger a pg-boss retry. Everything else — DB errors
  // from findOne/find/flush, parse/validation, terminal 4xx — is deterministic: mark the row FAILED
  // and consume the job, so a guaranteed-to-fail input never re-reserves budget or re-calls the
  // model across the retry limit.
  let enrichment: null | TransactionEnrichment = null;
  try {
    enrichment = await em.findOne(TransactionEnrichment, { transactionEnrichmentKey: payload.transactionEnrichmentKey });
    if (!enrichment) {
      log.warn({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE }, 'Transaction enrichment row not found');
      return false;
    }
    if (TERMINAL_STATUSES.includes(enrichment.status)) {
      log.info({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE, status: enrichment.status }, 'Transaction enrichment row already terminal; skipping');
      return true;
    }

    const tenantKey = resolveTenantKey(enrichment.tenantKey);
    const transactionKey = resolveTransactionKey(enrichment.transactionKey);

    const transaction = await em.findOne(Transaction, { transactionKey }, { populate: ['transactionMerchantKey', 'accountKey'] });
    if (!transaction) {
      log.warn({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE }, 'Transaction enrichment target transaction not found');
      return false;
    }

    const categories = await loadCandidateCategories(em, tenantKey, resolveAccountOwnerKey(transaction));

    enrichment.attemptCount += 1;
    enrichment.lastAttemptAt = now();

    // Budget reservation BEFORE any model call. Exhausted → skip, never call the model.
    //
    // Reserved once per enrichment, not once per attempt. `attemptCount` is incremented
    // and flushed on the retryable-transport path, so a value above 1 means this job
    // already holds a reservation from a previous attempt — re-reserving would charge a
    // 3-retry job four units of the tenant's daily cap for one enrichment, and could
    // exhaust a tenant's budget on a DeepSeek outage without producing a single result.
    const alreadyReserved = enrichment.attemptCount > 1;
    if (tenantKey === undefined || (!alreadyReserved && !(await reserveBudget(em, tenantKey, utcDay(now()), config.dailyTenantBudget)))) {
      enrichment.status = TransactionEnrichmentStatus.SKIPPED;
      enrichment.eligibilityReason = 'budget_exhausted';
      await em.flush();
      log.info({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE }, 'Transaction enrichment skipped: daily tenant budget exhausted');
      return true;
    }

    const suggestion = await requestSuggestion({
      candidateText: buildCandidateText(transaction),
      categories,
      direction: resolveDirection(transaction),
      modelVersion: config.modelVersion,
      promptVersion: config.promptVersion,
    });

    enrichment.promptTokens = suggestion.tokens.promptTokens;
    enrichment.completionTokens = suggestion.tokens.completionTokens;
    enrichment.totalTokens = suggestion.tokens.totalTokens;
    enrichment.estimatedCostUsd = estimateTransactionEnrichmentCostUsd(suggestion.tokens.promptTokens, suggestion.tokens.completionTokens);
    enrichment.confidence = suggestion.result.confidence;
    enrichment.merchantSuggestion = suggestion.result.merchantSuggestion ?? undefined;
    enrichment.reasonCode = suggestion.result.reasonCode;
    enrichment.inputHash = suggestion.inputHash;
    if (suggestion.result.categorySuggestionKey !== null) {
      enrichment.categorySuggestionKey = getRef(em, Category, suggestion.result.categorySuggestionKey);
    }
    enrichment.completedAt = now();
    // `write` mode applies a confident suggestion to a still-uncategorized transaction; a
    // recorded-but-not-applied suggestion stays `SHADOW`. `shadow` mode never applies.
    const applied = config.mode === 'write' && (await applySuggestionIfEligible(em, transaction, suggestion.result, config.writeConfidenceThreshold));
    enrichment.status = applied ? TransactionEnrichmentStatus.COMPLETED : TransactionEnrichmentStatus.SHADOW;
    if (applied) enrichment.eligibilityReason = 'applied';

    await em.flush();
    log.info(
      {
        attemptCount: enrichment.attemptCount,
        completionTokens: enrichment.completionTokens,
        correlationId: payload.correlationId,
        estimatedCostUsd: enrichment.estimatedCostUsd,
        jobId: job.id,
        modelVersion: config.modelVersion,
        promptTokens: enrichment.promptTokens,
        promptVersion: config.promptVersion,
        queue: TRANSACTION_ENRICHMENT_GPT_QUEUE,
        status: enrichment.status,
        totalTokens: enrichment.totalTokens,
      },
      'Transaction enrichment suggestion recorded',
    );
    return true;
  } catch (error) {
    if (isRetryableTransportError(error)) {
      // Persist the attempt bookkeeping (best-effort), then throw so pg-boss retries with backoff
      // (and DLQs once retryLimit is exhausted). Never record an error status on a transient failure.
      if (enrichment) {
        try {
          await em.flush();
        } catch {
          // Attempt bookkeeping is best-effort; the retry itself is what matters.
        }
      }
      log.warn(
        { attemptCount: enrichment?.attemptCount, jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE, status: transportStatus(error) },
        'Transaction enrichment transient transport failure; retrying',
      );
      throw error;
    }
    if (!enrichment) {
      // A DB error before the row loaded: deterministic, do not retry.
      log.warn(
        { errorCode: safeErrorCode(error), jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE },
        'Transaction enrichment failed before the row could be loaded',
      );
      return false;
    }
    enrichment.status = TransactionEnrichmentStatus.FAILED;
    enrichment.errorCode = safeErrorCode(error);
    try {
      await em.flush();
    } catch {
      // The FAILED status write is best-effort; still consume the job (no retry of a deterministic failure).
    }
    log.warn(
      { attemptCount: enrichment.attemptCount, errorCode: enrichment.errorCode, jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_QUEUE },
      'Transaction enrichment terminal failure',
    );
    return true;
  }
}

/**
 * The system category the enrichment pipeline is never allowed to write. See
 * `applySuggestionIfEligible` for why.
 */
const UNINFORMATIVE_CATEGORY_NAME = 'OTHER';

/**
 * Apply a confident AI suggestion to a still-uncategorized transaction (write mode).
 *
 * Guardrails: needs a category suggestion, a confidence at/above the threshold, and a resolvable
 * account owner; and it only applies when the transaction has NO existing category for that user, so
 * it never overwrites a real user choice made between enqueue and apply. The applied category is
 * marked `ai_suggested` and left `reviewed=false`, so it shows up in the review inbox for the user to
 * confirm or correct — the human always stays in the loop. Returns whether it applied.
 */
async function applySuggestionIfEligible(
  em: typeof DI.em,
  transaction: Transaction,
  result: { categorySuggestionKey: null | number; confidence: number },
  threshold: number,
): Promise<boolean> {
  if (result.categorySuggestionKey === null || result.confidence < threshold) return false;

  const appuserKey = resolveAccountOwnerKey(transaction);
  if (appuserKey === undefined) return false;

  // Never write `OTHER`, at any confidence. It is the model's most common
  // suggestion by far. Writing it is worse than writing nothing — it carries no
  // information *and* it marks the transaction categorised, so it stops being an
  // enrichment candidate and drops off every needs-attention surface. Matched by
  // name because the key is seed-order dependent (see CategorySeeder).
  const suggested = await em.findOne(Category, { categoryKey: result.categorySuggestionKey });
  if (!suggested) return false;
  if (suggested.isSystemCategory && suggested.name === UNINFORMATIVE_CATEGORY_NAME) return false;

  const existing = await em.findOne(
    AppuserTransactionCategory,
    { appuserKey: getRef(em, Appuser, appuserKey), deletedAt: undefined, transactionKey: transaction },
  );
  if (existing) return false;

  const assignment = new AppuserTransactionCategory();
  assignment.appuserKey = getRef(em, Appuser, appuserKey);
  assignment.transactionKey = transaction;
  assignment.categoryKey = getRef(em, Category, result.categorySuggestionKey);
  assignment.source = AppuserTransactionCategorySource.OPENAI;
  em.persist(assignment);

  transaction.categorizationConfidence = CategorizationConfidence.MEDIUM;
  transaction.categorizationReason = 'ai_suggested';
  transaction.reviewed = false;
  return true;
}

function buildCandidateText(transaction: Transaction): null | string {
  const merchant = transaction.transactionMerchantKey as unknown as undefined | { name?: string };
  return merchant?.name ?? transaction.description ?? null;
}

function isRetryableTransportError(error: unknown): boolean {
  const status = transportStatus(error);
  return status !== undefined && (status === 429 || status >= 500);
}

// Below this many distinct categories in the user's own correction history, the personalized list
// is too narrow to be a reliable candidate set (e.g. a brand-new user); fall back to the full list.
const MIN_PERSONALIZED_CATEGORIES = 3;
// Upper bound on how many personalized categories are offered as candidates.
const MAX_PERSONALIZED_CATEGORIES = 15;

async function loadCandidateCategories(
  em: typeof DI.em,
  tenantKey: number | undefined,
  appuserKey: number | undefined,
): Promise<{ categoryKey: number; label: string }[]> {
  if (tenantKey === undefined) return [];

  const personalized = appuserKey === undefined ? [] : await loadPersonalizedCandidateCategories(em, appuserKey);
  if (personalized.length >= MIN_PERSONALIZED_CATEGORIES) return personalized;

  const categories = await em.find(
    Category,
    { $or: [{ tenantKey: getRef(em, Tenant, tenantKey) }, { isSystemCategory: true, tenantKey: null }], deletedAt: undefined },
  );
  return categories.map((category) => ({ categoryKey: category.categoryKey, label: category.name }));
}

/**
 * Personalize the candidate list to the categories this user actually uses: ranks
 * by the same per-user correction-vote counts (`TransactionCategoryStats`, source=user) that already
 * drive the deterministic categorizer's stats fallback — an aggregated signal, so no
 * raw transaction history is ever read or sent to the model, only category labels.
 */
async function loadPersonalizedCandidateCategories(
  em: typeof DI.em,
  appuserKey: number,
): Promise<{ categoryKey: number; label: string }[]> {
  const stats = await em.find(
    TransactionCategoryStats,
    { appuserKey: getRef(em, Appuser, appuserKey), deletedAt: undefined, source: TransactionCategoryStatsSource.USER },
    { populate: ['categoryKey'] },
  );

  const totalsByCategory = new Map<number, { count: number; label: string }>();
  for (const stat of stats as unknown as { categoryKey: { categoryKey: number; name: string }; count: number }[]) {
    const key = stat.categoryKey.categoryKey;
    const existing = totalsByCategory.get(key);
    if (existing) existing.count += stat.count;
    else totalsByCategory.set(key, { count: stat.count, label: stat.categoryKey.name });
  }

  return [...totalsByCategory.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, MAX_PERSONALIZED_CATEGORIES)
    .map(([categoryKey, { label }]) => ({ categoryKey, label }));
}

function resolveAccountOwnerKey(transaction: Transaction): number | undefined {
  const account = transaction.accountKey as unknown as undefined | { accountOwnerAppuserKey?: undefined | { appuserKey?: number } };
  const owner = account?.accountOwnerAppuserKey;
  return owner && typeof owner.appuserKey === 'number' ? owner.appuserKey : undefined;
}

function resolveDirection(transaction: Transaction): 'credit' | 'debit' | 'unknown' {
  const amount = transaction.settlementAmount;
  if (typeof amount !== 'number' || Number.isNaN(amount) || amount === 0) return 'unknown';
  return amount > 0 ? 'credit' : 'debit';
}

function resolveTenantKey(tenantKey: unknown): number | undefined {
  if (typeof tenantKey === 'number') return tenantKey;
  if (tenantKey && typeof tenantKey === 'object' && 'tenantKey' in tenantKey) {
    const value = (tenantKey as { tenantKey?: number }).tenantKey;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

function resolveTransactionKey(transactionKey: unknown): number {
  if (typeof transactionKey === 'number') return transactionKey;
  if (transactionKey && typeof transactionKey === 'object' && 'transactionKey' in transactionKey) {
    return (transactionKey as { transactionKey: number }).transactionKey;
  }
  return Number(transactionKey);
}

function safeErrorCode(error: unknown): string {
  const status = transportStatus(error);
  if (status !== undefined) return `transport_${status}`;
  if (error instanceof Error && error.message === 'transaction enrichment response missing') return 'empty_model_response';
  if (error instanceof Error && error.message === 'transaction enrichment invalid response') return 'invalid_model_response';
  return 'enrichment_failed';
}

function transportStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  return undefined;
}

/**
 * The budget day is a **UTC** calendar day, which for Portuguese users means the daily cap
 * resets at 01:00 local in summer rather than at midnight.
 *
 * Left as UTC deliberately. `transaction_enrichment_budget` is keyed `(tenant_key, day)`,
 * so moving the boundary to Europe/Lisbon would let every tenant reserve against two
 * different day keys during the changeover — briefly doubling the cap this exists to
 * enforce — and it changes the meaning of existing rows. It is a cost-accounting nit, not
 * a correctness bug: no user-visible behaviour depends on where the boundary falls.
 */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
