import type { EntityManager } from '@mikro-orm/postgresql';

import type { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import type { Category } from '@entity/Category';
import type { Transaction } from '@entity/Transaction';
import { stampTransactionEnrichmentOutcome } from '@service/transaction-enrichment/transaction-enrichment-outcome.service';
import { markUserCategorized } from '@service/transaction/categorization-confidence';
import { decrementMerchantCategoryStat, incrementMerchantCategoryStat, learnAppuserMerchantCategory } from '@service/transaction/merchant-category-stats.service';

export interface UserCategorizationInput {
  /** The household member making the choice — their merchant votes and learned mapping are updated. */
  actor: Appuser;
  /** Already resolved through `findAssignableCategory`. */
  category: Category;
  /** Persisted transactions with `appuserTransactionCategories.categoryKey` and `transactionMerchantKey` loaded. */
  transactions: Transaction[];
}

/**
 * A household member explicitly put `category` on these transactions. This is the one place that
 * knows everything that follows from that choice:
 *
 * - the category assignment (`AppuserTransactionCategory`) is moved, or created if there was none;
 * - categorization confidence is stamped `high` / `user_edit` (`reviewed` is the caller's call);
 * - an outstanding AI suggestion is marked accepted or overridden;
 * - the actor's merchant→category vote moves from the old category to the new one, and the
 *   per-user merchant mapping is learned — only where the transaction has a merchant.
 *
 * Returns each transaction's previous category (`undefined` when it had none) by `transactionKey`,
 * so callers can write their audit entries.
 */
export async function applyUserCategorization(em: EntityManager, input: UserCategorizationInput): Promise<Map<number, Category | undefined>> {
  const { actor, category, transactions } = input;
  const previousCategories = new Map<number, Category | undefined>();

  for (const transaction of transactions) {
    const assignment = transaction.appuserTransactionCategories.getItems()[0];
    previousCategories.set(transaction.transactionKey, assignment?.categoryKey);
    if (assignment) {
      assignment.categoryKey = category;
      em.persist(assignment);
    } else {
      const created = new AppuserTransactionCategory();
      created.appuserKey = actor;
      created.transactionKey = transaction;
      created.categoryKey = category;
      created.source = Source.USER;
      // Setting the owning side also adds `created` to the loaded inverse collection (MikroORM
      // propagation), so the caller's in-memory transaction reflects the new category.
      em.persist(created);
    }
    markUserCategorized(transaction);
    em.persist(transaction);
  }
  await em.flush();

  for (const transaction of transactions) {
    await stampTransactionEnrichmentOutcome(em, transaction.transactionKey, category.categoryKey);
    const merchant = transaction.transactionMerchantKey;
    if (!merchant) continue;
    // Each write is an atomic upsert/update, so concurrent or double-submitted edits can't race on
    // the per-user unique constraint (API-QB).
    const previous = previousCategories.get(transaction.transactionKey);
    if (previous) await decrementMerchantCategoryStat(em, merchant, previous, actor);
    await incrementMerchantCategoryStat(em, merchant, category, actor);
    await learnAppuserMerchantCategory(em, actor, merchant, category);
  }

  return previousCategories;
}
