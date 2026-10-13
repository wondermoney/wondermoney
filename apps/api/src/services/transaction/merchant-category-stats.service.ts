import type { EntityManager } from '@mikro-orm/postgresql';

import type { Appuser } from '@entity/Appuser';
import type { Category } from '@entity/Category';
import { Source } from '@entity/TransactionCategoryStats';
import type { TransactionMerchant } from '@entity/TransactionMerchant';
import logger from '@utils/logger';

/**
 * Atomically record a "this merchant was categorised as X" vote in `transaction_category_stats`.
 *
 * Uses a single `INSERT ... ON CONFLICT DO UPDATE`, so concurrent or double-submitted category
 * edits for the same (merchant, category, source) increment the existing row instead of racing on
 * the unique constraint. This replaces the previous check-then-insert (findOne → new → flush),
 * which 500'd when two requests both saw "no row" and both inserted the same tuple (API-QB).
 *
 * `created_at`/`updated_at` are supplied explicitly because the column is NOT NULL with no DB
 * default; `default` and the serial PK fall through to their DB defaults.
 *
 * Stats are scoped **per user** (`appuser_key`, RAD-342 G4): a tenant is now a household of up to
 * two members, and each member's votes must stay their own — otherwise one member's bulk
 * categorization would silently steer the other's suggestions. The conflict target therefore
 * includes `appuser_key`, matching the per-user unique constraint.
 */
export async function incrementMerchantCategoryStat(
  em: EntityManager,
  merchant: TransactionMerchant,
  category: Category,
  appuser: Appuser,
  source: Source = Source.USER,
): Promise<void> {
  await em.execute(
    `insert into "transaction_category_stats"
       ("created_at", "updated_at", "transaction_merchant_key", "category_key", "appuser_key", "count", "source")
     values (now(), now(), ?, ?, ?, 1, ?)
     on conflict ("transaction_merchant_key", "category_key", "source", "appuser_key")
     do update set "count" = "transaction_category_stats"."count" + 1, "updated_at" = now()`,
    [merchant.transactionMerchantKey, category.categoryKey, appuser.appuserKey, source],
  );
}

/**
 * Atomically lower the vote count for a (merchant, category, source, appuser) row. No-op when the
 * row does not exist — this mirrors the previous "only decrement if the stats exist" behaviour
 * without a separate read, and is safe against concurrent edits. Per-user scoped (RAD-342 G4).
 */
export async function decrementMerchantCategoryStat(
  em: EntityManager,
  merchant: TransactionMerchant,
  category: Category,
  appuser: Appuser,
  source: Source = Source.USER,
): Promise<void> {
  await em.execute(
    `update "transaction_category_stats"
       set "count" = "count" - 1, "updated_at" = now()
     where "transaction_merchant_key" = ? and "category_key" = ? and "source" = ? and "appuser_key" = ?`,
    [merchant.transactionMerchantKey, category.categoryKey, source, appuser.appuserKey],
  );
}

/**
 * Learn the per-user merchant→category mapping from an explicit user categorization (RAD-342.1).
 *
 * Maintains exactly ONE active `AppuserMerchantCategory` per (appuser, merchant) — the categorizer's
 * `pickUniqueValidCategory` treats >1 active mapping as ambiguous and ignores the signal, so this is
 * a last-wins replace: retire other-category actives, then upsert (create/restore/no-op) the target.
 *
 * Best-effort: a failure here must never break the user's category edit.
 */
export async function learnAppuserMerchantCategory(
  em: EntityManager,
  appuser: Appuser,
  merchant: TransactionMerchant,
  category: Category,
): Promise<void> {
  const appuserKey = appuser.appuserKey;
  const merchantKey = merchant.transactionMerchantKey;
  const categoryKey = category.categoryKey;
  try {
    await em.execute(
      `update "appuser_merchant_category"
          set "deleted_at" = now(), "updated_at" = now()
        where "appuser_key" = ? and "transaction_merchant_key" = ? and "category_key" <> ? and "deleted_at" is null`,
      [appuserKey, merchantKey, categoryKey],
    );
    await em.execute(
      `insert into "appuser_merchant_category"
          ("created_at", "updated_at", "appuser_key", "transaction_merchant_key", "category_key", "source")
        values (now(), now(), ?, ?, ?, 'user')
        on conflict ("appuser_key", "transaction_merchant_key", "category_key")
        do update set "source" = 'user', "deleted_at" = null, "updated_at" = now()`,
      [appuserKey, merchantKey, categoryKey],
    );
  } catch (error) {
    logger.warn(
      {
        appuserKey,
        categoryKey,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        merchantKey,
      },
      'merchant-category mapping write failed',
    );
  }
}
