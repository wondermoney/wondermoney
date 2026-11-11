/**
 * The local, token-free categorization pass.
 *
 * It runs after the deterministic categorizer and before AI enrichment, on the rows an ingestion
 * just created. It trains one naive-Bayes model per household and viewer from the viewer's own
 * confirmed categories, then labels a row only when the model is sure. Nothing is persisted about
 * the model itself: it is rebuilt per batch, which keeps v1 stateless.
 *
 * This is not AI. It reads the database and computes locally, so it runs even for a person who
 * hid AI; only a row it leaves unassigned can reach the enrichment queue.
 */
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager, FilterQuery } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { isUncategorisableByDescription } from '@service/transaction-enrichment/enrichment-eligibility';
import { applyCategorizationOutcome } from '@service/transaction/categorization-confidence';
import { transactionScopeWhere } from '@service/transaction/transaction-scope';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

import {
  type BayesModel,
  bayesThresholds,
  type BayesThresholds,
  type BayesTrainingSample,
  decideBayes,
  isBayesCategorizationEnabled,
  scoreBayes,
  trainBayesModel,
} from './bayes-categorizer';

/** How far back the model looks. A cap keeps a long history from turning one sync into a scan. */
const TRAINING_ROW_LIMIT = 5000;

export interface BayesCategorizationTarget {
  tenantKey: number;
  viewerAppuserKey: number;
}

/** A training row, with the date the eval script orders its holdout by. */
export interface LoadedTrainingSample extends BayesTrainingSample {
  transactionDate: Date | null;
}

/** One trained model plus the thresholds it is applied with; reuse it for the whole batch. */
export interface BayesCategorizationBatch {
  model: BayesModel | null;
  thresholds: BayesThresholds;
  viewerAppuserKey: number;
}

export interface BayesCategorizationOptions {
  /** Overrides the environment switch, for callers that already know. */
  enabled?: boolean;
  thresholds?: BayesThresholds;
}

/**
 * Train the viewer's model once for a batch. Returns null when the pass is switched off, so a
 * caller can skip the work entirely.
 */
export async function prepareBayesCategorization(
  em: EntityManager,
  target: BayesCategorizationTarget,
  options: BayesCategorizationOptions = {},
): Promise<BayesCategorizationBatch | null> {
  if (!(options.enabled ?? isBayesCategorizationEnabled())) return null;
  const samples = await loadBayesTrainingSamples(em, target);
  return {
    model: trainBayesModel(samples),
    thresholds: options.thresholds ?? bayesThresholds(),
    viewerAppuserKey: target.viewerAppuserKey,
  };
}

/**
 * Label the batch's rows the model is sure about. Rows that already have a category, that the
 * model abstains on, or that no categorizer can legitimately label (withdrawals and transfers)
 * are left alone. Returns how many rows were assigned.
 */
export async function applyBayesCategorization(
  em: EntityManager,
  batch: BayesCategorizationBatch | null,
  transactions: readonly Transaction[],
): Promise<number> {
  if (!batch?.model || transactions.length === 0) return 0;

  const viewer = getRef(em, Appuser, batch.viewerAppuserKey);
  const existing = await em.find(AppuserTransactionCategory, { appuserKey: viewer, deletedAt: undefined, transactionKey: { $in: [...transactions] } });
  const categorized = new Set(existing.map((assignment) => assignment.transactionKey.transactionKey));
  const categories = new Map<number, Category | null>();
  let assigned = 0;

  for (const transaction of transactions) {
    if (categorized.has(transaction.transactionKey)) continue;
    if (transaction.categorizationConfidence === CategorizationConfidence.HIGH) continue;
    if (isUncategorisableByDescription(transaction)) continue;

    const prediction = decideBayes(scoreBayes(batch.model, featuresOfTransaction(transaction)), batch.thresholds);
    if (!prediction) continue;

    try {
      const category = await resolveCategory(em, categories, prediction.categoryKey, viewer);
      if (!category) continue;
      const assignment = new AppuserTransactionCategory();
      assignment.appuserKey = viewer;
      assignment.transactionKey = transaction;
      assignment.categoryKey = category;
      assignment.source = Source.DETERMINISTIC;
      await em.persist(assignment).flush();
      applyCategorizationOutcome(transaction, 'bayes_suggested');
      await em.persist(transaction).flush();
      assigned += 1;
    } catch (error) {
      // A row a concurrent writer already categorized is skipped; anything else is logged and the
      // batch continues, because one row must never cost the sync its other suggestions.
      if (error instanceof UniqueConstraintViolationException) continue;
      logger.warn(
        { error: error instanceof Error ? error.message : 'unknown', transactionKey: transaction.transactionKey },
        'Bayes categorization failed for a transaction',
      );
    }
  }

  return assigned;
}

/**
 * The viewer's own confirmed categories in the household, oldest-to-newest irrelevant: the model
 * only counts. Scoped by tenant and by account privacy through the shared transaction scope, so a
 * co-member's private rows never train the viewer's model.
 */
export async function loadBayesTrainingSamples(
  em: EntityManager,
  target: BayesCategorizationTarget,
): Promise<LoadedTrainingSample[]> {
  const rows = await em.find(
    Transaction,
    {
      ...transactionScopeWhere({
        includeHidden: false,
        includeNonSpending: true,
        includeTransfers: false,
        statuses: 'not-expired',
        tenantKey: target.tenantKey,
        viewerAppuserKey: target.viewerAppuserKey,
      }),
      deletedAt: undefined,
      tenantKey: target.tenantKey,
    } as FilterQuery<Transaction>,
    { limit: TRAINING_ROW_LIMIT, orderBy: { transactionDate: 'DESC' }, populate: ['appuserTransactionCategories'] },
  );

  const samples: LoadedTrainingSample[] = [];
  for (const transaction of rows) {
    if (isUncategorisableByDescription(transaction)) continue;
    const assignment = transaction.appuserTransactionCategories.getItems().find(
      (item) => !item.deletedAt
        && item.appuserKey.appuserKey === target.viewerAppuserKey
        && (item.source === Source.USER || item.source === Source.MANUAL || transaction.categorizationConfidence === CategorizationConfidence.HIGH),
    );
    const categoryKey = assignment?.categoryKey.categoryKey;
    if (typeof categoryKey !== 'number') continue;

    const amount = transaction.appuserSettlementAmount ?? transaction.editedSettlementAmount ?? transaction.settlementAmount ?? null;
    if (amount === null) continue;

    samples.push({
      accountKey: transaction.accountKey?.accountKey ?? null,
      amount,
      categoryKey,
      description: transaction.description ?? transaction.descriptionDirty ?? null,
      direction: amount >= 0 ? 'in' : 'out',
      merchantKey: transaction.transactionMerchantKey?.transactionMerchantKey ?? null,
      transactionDate: transaction.transactionDate ?? null,
    });
  }
  return samples;
}

function featuresOfTransaction(transaction: Transaction) {
  const amount = transaction.appuserSettlementAmount ?? transaction.editedSettlementAmount ?? transaction.settlementAmount ?? null;
  return {
    accountKey: transaction.accountKey?.accountKey ?? null,
    amount,
    description: transaction.description ?? transaction.descriptionDirty ?? null,
    direction: (amount ?? 0) >= 0 ? ('in' as const) : ('out' as const),
    merchantKey: transaction.transactionMerchantKey?.transactionMerchantKey ?? null,
  };
}

/** A category the viewer may use: their own or a system one. Cached for the batch. */
async function resolveCategory(
  em: EntityManager,
  cache: Map<number, Category | null>,
  categoryKey: number,
  viewer: Appuser,
): Promise<Category | null> {
  const cached = cache.get(categoryKey);
  if (cached !== undefined) return cached;
  const category = await em.findOne(Category, {
    $or: [{ appuserKey: viewer }, { isSystemCategory: true }],
    categoryKey,
    deletedAt: undefined,
  });
  cache.set(categoryKey, category);
  return category;
}
