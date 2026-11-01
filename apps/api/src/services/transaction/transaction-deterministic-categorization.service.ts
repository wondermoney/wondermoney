import { UniqueConstraintViolationException } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserMerchantCategory } from '@entity/AppuserMerchantCategory';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import { TransactionCategoryStats, Source as TransactionCategoryStatsSource } from '@entity/TransactionCategoryStats';
import { TransactionMerchant } from '@entity/TransactionMerchant';

import { pickRecencyWeightedTopStat } from './category-stats-recency';

export type DeterministicCategorizationReason =
  | 'already_categorized'
  | 'category_invalid'
  | 'disabled'
  | 'duplicate'
  | 'duplicate-assignment'
  | 'merchant_ambiguous'
  | 'merchant_no_mapping'
  | 'stats_default'
  | 'stats_tie'
  | 'stats_top_count'
  | 'unsafe_text'
  | 'user_mapping'
;

export interface DeterministicCategorizationResult {
  assigned: boolean;
  category?: Category;
  reason: DeterministicCategorizationReason;
  source?: 'merchant' | 'stats_default' | 'stats_top_count' | 'user_mapping';
}

interface EntityManagerLike {
  find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>): Promise<T[]>;
  findOne<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>): Promise<null | T>;
  persist(entity: unknown): { flush(): Promise<void> };
}

class TransactionDeterministicCategorizationService {
  async categorizeTransactionDeterministically(
    { appuser, transaction }: { appuser: Appuser; transaction: Transaction },
    { em }: { em: EntityManagerLike },
  ): Promise<DeterministicCategorizationResult> {
    if (!isEnabled(process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'])) return { assigned: false, reason: 'disabled' };
    const existing = await em.findOne(AppuserTransactionCategory, { appuserKey: appuser, deletedAt: undefined, transactionKey: transaction });
    if (existing) return { assigned: false, reason: 'already_categorized' };

    const text = normalizeText(transaction.description ?? transaction.descriptionDirty);
    if (!isSafeText(text)) return { assigned: false, reason: 'unsafe_text' };
    if (!transaction.tenantKey) return { assigned: false, reason: 'merchant_no_mapping' };

    const merchants = await em.find(TransactionMerchant, { deletedAt: undefined, tenantKey: transaction.tenantKey });
    const matchedMerchant = merchants.filter((merchant) => normalizeText(merchant.name) === text);
    if (matchedMerchant.length > 1) return { assigned: false, reason: 'merchant_ambiguous' };

    const merchant = matchedMerchant[0];
    if (!merchant) return { assigned: false, reason: 'merchant_no_mapping' };

    const mappings = await em.find(AppuserMerchantCategory, { appuserKey: appuser, deletedAt: undefined, transactionMerchantKey: merchant });
    const category = await this.pickUniqueValidCategory(em, mappings.map((mapping) => mapping.categoryKey), appuser);
    if (category) return this.persistAssignment(em, appuser, transaction, category, 'user_mapping');
    if (mappings.length > 0) return { assigned: false, reason: 'category_invalid' };

    // Stats are scoped to THIS user: in a household, only the requesting member's own
    // merchant→category votes may inform their suggestions — never a co-member's. `appuser` is a
    // required, non-null `Appuser` here (enforced by the type + every call site), so the per-user
    // predicate can never be silently stripped by MikroORM into an unscoped, cross-member read.
    const stats = await em.find(TransactionCategoryStats, { appuserKey: appuser, deletedAt: undefined, source: TransactionCategoryStatsSource.USER, transactionMerchantKey: merchant });
    const defaultStats = stats.filter((stat) => stat.default);
    if (defaultStats.length === 1) {
      const stat = defaultStats[0];
      if (!stat) return { assigned: false, reason: 'stats_tie' };
      const matchedCategory = await this.pickUniqueValidCategory(em, [stat.categoryKey], appuser);
      return matchedCategory ? this.persistAssignment(em, appuser, transaction, matchedCategory, 'stats_default') : { assigned: false, reason: 'category_invalid' };
    }
    if (defaultStats.length > 1) return { assigned: false, reason: 'stats_tie' };
    if (stats.length === 0) return { assigned: false, reason: 'merchant_no_mapping' };
    // Recency-weighted winner: a recent correction outweighs a stale pile of votes; a
    // shared top score is still a tie the user should resolve.
    const topStat = pickRecencyWeightedTopStat(stats);
    if (!topStat) return { assigned: false, reason: 'stats_tie' };
    const matchedCategory = await this.pickUniqueValidCategory(em, [topStat.categoryKey], appuser);
    return matchedCategory ? this.persistAssignment(em, appuser, transaction, matchedCategory, 'stats_top_count') : { assigned: false, reason: 'category_invalid' };
  }

  private async persistAssignment(em: EntityManagerLike, appuser: Appuser, transaction: Transaction, category: Category, source: DeterministicCategorizationResult['source']): Promise<DeterministicCategorizationResult> {
    const assignment = new AppuserTransactionCategory();
    assignment.appuserKey = appuser;
    assignment.transactionKey = transaction;
    assignment.categoryKey = category;
    assignment.source = Source.DETERMINISTIC;
    try {
      await em.persist(assignment).flush();
      return { assigned: true, category, reason: source === 'user_mapping' ? 'user_mapping' : source === 'stats_default' ? 'stats_default' : 'stats_top_count', source };
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) return { assigned: false, reason: 'duplicate-assignment' };
      throw error;
    }
  }

  private async pickUniqueValidCategory(em: EntityManagerLike, categories: Category[], appuser: Appuser): Promise<Category | null> {
    const valid: Category[] = [];
    for (const candidate of categories) {
      const categoryKey = candidate.categoryKey;
      if (typeof categoryKey !== 'number') continue;
      const category = await em.findOne(Category, { $or: [{ appuserKey: appuser }, { isSystemCategory: true }], categoryKey, deletedAt: undefined });
      if (category) valid.push(category);
    }
    if (valid.length !== 1) return null;
    return valid[0] ?? null;
  }
}

function isEnabled(value: unknown): boolean {
  // On by default: deterministic categorization runs unless explicitly disabled via
  // TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED=false. No env var is needed to turn it on.
  if (typeof value !== 'string') return true;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

function isSafeText(value?: string): boolean {
  return !!value && value.length > 1 && value.length <= 255 && !/^(?:mb way|pt\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d?)$/i.test(value);
}

function normalizeText(value?: null | string): string | undefined {
  const normalized = value?.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized || undefined;
}

export default new TransactionDeterministicCategorizationService();
