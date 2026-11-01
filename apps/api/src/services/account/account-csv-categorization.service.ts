import type { Appuser } from '@entity/Appuser';
import { AppuserMerchantCategory } from '@entity/AppuserMerchantCategory';
import { AppuserTransactionCategory, Source as AppuserTransactionCategorySource } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import { TransactionCategoryStats } from '@entity/TransactionCategoryStats';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { pickRecencyWeightedTopStat } from '@service/transaction/category-stats-recency';
import type { DeterministicCategorizationReason } from '@service/transaction/transaction-deterministic-categorization.service';

interface CategorizationEntityManager {
  find: <T>(entity: new () => T, where: Record<string, unknown>) => Promise<T[]>;
  findOne: <T>(entity: new () => T, where: Record<string, unknown>) => Promise<null | T>;
  persist: (entity: AppuserTransactionCategory) => { flush(): Promise<void> };
}

interface CategorizationOutcome {
  assigned: boolean;
  reason: DeterministicCategorizationReason;
}

class AccountCsvCategorizationService {
  async categorizeTransaction(em: CategorizationEntityManager, appuser: unknown, transaction: Transaction): Promise<CategorizationOutcome> {
    const transactionMerchant = transaction.transactionMerchantKey;
    const merchantName = transactionMerchant?.name ?? transaction.descriptionDirty ?? transaction.description ?? transaction.internalTransactionId;
    if (!merchantName) return { assigned: false, reason: 'merchant_no_mapping' };
    const merchant = transactionMerchant ?? await em.findOne(TransactionMerchant, { deletedAt: undefined, name: merchantName });
    if (!merchant) return { assigned: false, reason: 'merchant_no_mapping' };

    const mappings = await em.find(AppuserMerchantCategory, { appuserKey: appuser, deletedAt: undefined, transactionMerchantKey: merchant });
    const mapped = await this.pickUniqueCategory(em, mappings.map((item: AppuserMerchantCategory) => item.categoryKey), appuser);
    if (mapped) return this.persist(em, appuser, transaction, mapped, 'user_mapping');
    // Mappings exist but none resolved to a unique valid category — that's `category_invalid`, not an
    // ambiguous *merchant-name* match (`merchant_ambiguous`). Matches the deterministic categorizer's vocab.
    if (mappings.length > 0) return { assigned: false, reason: 'category_invalid' };

    // Stats scoped to THIS user — a household co-member's votes must not leak in. Fail
    // closed if the user is absent (MikroORM would strip an `undefined` where-value and widen the
    // read to every member's votes).
    if (!isPresentAppuserKey(appuser)) return { assigned: false, reason: 'merchant_no_mapping' };
    const stats = await em.find(TransactionCategoryStats, { appuserKey: appuser, deletedAt: undefined, transactionMerchantKey: merchant });
    if (stats.length === 0) return { assigned: false, reason: 'merchant_no_mapping' };
    // Recency-weighted winner — matches the deterministic categorizer so synced and
    // imported transactions resolve identically.
    const top = pickRecencyWeightedTopStat(stats) ?? undefined;
    if (!top) return { assigned: false, reason: 'stats_tie' };
    const category = await this.pickUniqueCategory(em, [top.categoryKey], appuser);
    // A unique top stat was found but its category didn't resolve to a valid one — that's
    // `category_invalid`, not a tie (a genuine tie is the `!top` case above). Matches the deterministic vocab.
    if (!category) return { assigned: false, reason: 'category_invalid' };
    return this.persist(em, appuser, transaction, category, 'stats_top_count');
  }

  private async persist(em: Pick<CategorizationEntityManager, 'persist'>, appuser: unknown, transaction: Transaction, category: Category, reason: DeterministicCategorizationReason): Promise<CategorizationOutcome> {
    const assignment = new AppuserTransactionCategory();
    assignment.appuserKey = appuser as Appuser;
    assignment.transactionKey = transaction;
    assignment.categoryKey = category;
    assignment.source = AppuserTransactionCategorySource.DETERMINISTIC;
    await em.persist(assignment).flush();
    return { assigned: true, reason };
  }

  private async pickUniqueCategory(em: Pick<CategorizationEntityManager, 'findOne'>, categories: unknown[], appuser: unknown): Promise<Category | null> {
    const valid: Category[] = [];
    for (const candidate of categories) {
      if (typeof candidate !== 'object' || candidate === null || !('categoryKey' in candidate)) continue;
      const category = candidate as { categoryKey: number };
      const found = await em.findOne(Category, { $or: [{ appuserKey: appuser }, { isSystemCategory: true }], categoryKey: category.categoryKey, deletedAt: undefined });
      if (found) valid.push(found);
    }
    return valid.length === 1 ? valid[0] ?? null : null;
  }
}

// `appuser` arrives here typed `unknown`, so guard at runtime before it scopes the per-user stats
// read — a missing key would otherwise be stripped by MikroORM into an unscoped,
// cross-member query.
function isPresentAppuserKey(appuser: unknown): boolean {
  return typeof appuser === 'object' && appuser !== null && 'appuserKey' in appuser && (appuser as { appuserKey?: unknown }).appuserKey != null;
}

export default new AccountCsvCategorizationService();
