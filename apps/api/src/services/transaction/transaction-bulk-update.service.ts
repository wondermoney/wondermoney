import type { EntityManager } from '@mikro-orm/postgresql';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import type { Appuser } from '@entity/Appuser';
import type { Category } from '@entity/Category';
import type { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { changeTransactionTags } from '@service/tag/tag.service';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { applyUserCategorization } from '@service/transaction/user-categorization.service';
import logger from '@utils/logger';

/** What `applyBulkTransactionChange` needs loaded on each transaction. */
export const BULK_CHANGE_POPULATE = ['appuserTransactionCategories.categoryKey', 'transactionMerchantKey'] as const;

export interface BulkTransactionActor {
  /** The member making the change: their merchant votes move, and the audit names them. */
  appuser: Appuser;
  tenant: Tenant;
}

export interface BulkTransactionChange {
  addTagIds?: number[];
  /** Already resolved through `findAssignableCategory`. Categorizing also marks the rows reviewed. */
  category?: Category | null;
  hidden?: boolean;
  removeTagIds?: number[];
  /** Only `true` does anything: this change never marks a row unreviewed. */
  reviewed?: boolean;
}

/**
 * Categorize, mark reviewed, hide or unhide, and tag or untag many transactions at once.
 *
 * The one implementation behind `PATCH /v1/account/transaction` and an applied assistant proposal,
 * so the two leave the same rows and the same audit entries behind. `transactions` were loaded by
 * the caller through the tenant filter (`loadTransactionSelection`) with
 * {@link BULK_CHANGE_POPULATE}. `auditSource` is the audit's `source`: `bulk-update` for the
 * endpoint, `assistant-proposal` for a confirmed proposal.
 */
export async function applyBulkTransactionChange(
  em: EntityManager,
  actor: BulkTransactionActor,
  transactions: Transaction[],
  change: BulkTransactionChange,
  options: { auditSource?: string } = {},
): Promise<void> {
  const { appuser, tenant } = actor;
  const { category = null, hidden, reviewed } = change;
  const selectedKeys = transactions.map((transaction) => transaction.transactionKey);

  // Tags are resolved (404 for a tag that is not the household's) before anything is written.
  const tagChanges = await changeTransactionTags(em, { appuserKey: appuser.appuserKey, tenantKey: tenant.tenantKey }, transactions, { add: change.addTagIds ?? [], remove: change.removeTagIds ?? [] });
  if (tagChanges.size > 0) await em.flush();
  // Bulk categorize persists the assignment and learns the merchant mapping exactly like the
  // single-transaction path — both go through applyUserCategorization, which also hands back each
  // transaction's *original* category so the audit `from` recorded below stays correct.
  const originalCategoryByTransaction = category
    ? await applyUserCategorization(em, { actor: appuser, category, transactions })
    : new Map<number, Category | undefined>();

  // The `reviewed` flag is uniform across every selected transaction, so this is a single bulk UPDATE
  // rather than one per transaction. nativeUpdate bypasses the tenant filter, so scope explicitly by
  // tenant (the ids were already validated against the household via the filtered load).
  const shouldSetReviewed = !!reviewed || !!category;
  // Only include the fields the caller actually intends to change. `hidden` is bidirectional
  // (true/false), unlike `reviewed` which this only ever sets to true — building this
  // unconditionally would silently reset `reviewed` to false on a hidden-only call.
  const transactionUpdate: { hidden?: boolean; reviewed?: boolean } = {};
  if (shouldSetReviewed) transactionUpdate.reviewed = true;
  if (hidden !== undefined) transactionUpdate.hidden = hidden;
  if (Object.keys(transactionUpdate).length > 0 && selectedKeys.length > 0) {
    await em.nativeUpdate(
      Transaction,
      {
        deletedAt: undefined,
        tenantKey: tenant,
        transactionKey: { $in: selectedKeys },
      },
      transactionUpdate,
      // The selected rows may be hidden ones (to unhide them); the keys already scope the update.
      { filters: { [HIDDEN_FILTER]: false } },
    );
  }

  // Best-effort audit of the bulk review/category/hidden/tag change (one row per transaction),
  // written in one flush rather than one per row: a filter can select thousands.
  let audited = 0;
  for (const transaction of transactions) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const tagChange = tagChanges.get(transaction.transactionKey);
    if (tagChange) changes['tagKeys'] = tagChange;
    if (shouldSetReviewed && !transaction.reviewed) {
      changes['reviewed'] = { from: transaction.reviewed, to: true };
    }
    if (hidden !== undefined && transaction.hidden !== hidden) {
      changes['hidden'] = { from: transaction.hidden, to: hidden };
    }
    if (category) {
      const currentCategory = originalCategoryByTransaction.get(transaction.transactionKey);
      changes['categoryKey'] = { from: currentCategory ? currentCategory.categoryKey : null, to: category.categoryKey };
    }
    if (Object.keys(changes).length === 0) continue;
    const logged = await TransactionAuditService.log(em, {
      actorAppuserKey: appuser.appuserKey,
      actorType: TransactionAuditActorType.USER,
      appuserKey: appuser.appuserKey,
      changes,
      eventType: category ? TransactionAuditEventType.CATEGORIZED : TransactionAuditEventType.USER_EDIT,
      source: options.auditSource ?? 'bulk-update',
      tenantKey: tenant.tenantKey,
      transactionKey: transaction.transactionKey,
    }, { flush: false });
    if (logged) audited += 1;
  }
  if (audited > 0) {
    // Best-effort, as each entry always was: a failed audit write does not undo or fail the change.
    try {
      await em.flush();
    } catch (error) {
      logger.warn({ audited, errorMessage: error instanceof Error ? error.message : 'Unknown error' }, 'Bulk update audit log write failed');
    }
  }
}
