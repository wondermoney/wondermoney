import { Migration } from '@mikro-orm/migrations';

/**
 * Make the soft-delete-sensitive unique constraints partial.
 *
 * ## The bug
 *
 * Only 6 of 28 unique indexes were partial on `deleted_at IS NULL`, while the code that
 * guards them consistently checks `deletedAt: undefined` — i.e. "is there an *active* row?".
 * The two disagree, and the gap is reachable:
 *
 *   `controller/loan.ts:196` looks for an active `LoanRepaymentLink` and, finding none,
 *   inserts at `:208`. But `loan_repayment_link_loan_key_transaction_key_unique` is not
 *   partial, so a previously soft-deleted link still occupies the key. Link a transaction to
 *   a loan, unlink it (soft delete), re-link the same transaction — the duplicate check
 *   passes, the insert violates the constraint, and the user gets an unhandled 500.
 *
 * The same shape is latent on the `appuser_merchant_category` constraint.
 *
 * `budget_template_category` was in this list and has been removed: it does **not** extend
 * `Base` and has no `deleted_at` column at all, so there are no soft-deleted rows to collide
 * with and its plain unique index is already correct. Adding a `where "deleted_at" is null`
 * index to it failed outright (`42703 column "deleted_at" does not exist`) when this
 * migration was verified against a scratch database — which, had it gone unnoticed, is
 * precisely the partway failure that leaves a database half-migrated during the maintenance
 * window this migration is held back for.
 *
 * ## Why partial rather than resurrection
 *
 * The bank-sync path already handles this correctly the other way — it finds the
 * soft-deleted row and clears `deletedAt` (`account-initial-sync-account.service.ts:194`).
 * That works but has to be written at every call site, and it was written at exactly one.
 * A partial unique index makes the constraint agree with what the code already asks for, so
 * the remaining sites need no change. `appuser_transaction_category_active_unique`
 * (`Migration20260525000100`) is already exactly this, so the precedent is in-repo.
 *
 * Note this means multiple soft-deleted rows may share a natural key. That is correct: they
 * are history, and history repeats.
 *
 * `CREATE INDEX CONCURRENTLY` cannot run in a transaction — hence `isTransactional()` false.
 * The drop and create are therefore not atomic: between them the constraint is absent, so
 * apply this when a concurrent duplicate insert is unlikely.
 */
export class Migration20260915190200 extends Migration {
  override async down(): Promise<void> {
    this.addSql(`drop index concurrently if exists "loan_repayment_link_active_unique";`);
    this.addSql(`alter table "loan_repayment_link" add constraint "loan_repayment_link_loan_key_transaction_key_unique" unique ("loan_key", "transaction_key");`);

    this.addSql(`drop index concurrently if exists "appuser_merchant_category_active_unique";`);
  }

  override isTransactional(): boolean {
    return false;
  }

  override async up(): Promise<void> {
    // The confirmed live bug: unlink then re-link the same transaction to the same loan.
    this.addSql(`alter table "loan_repayment_link" drop constraint if exists "loan_repayment_link_loan_key_transaction_key_unique";`);
    // Defensive: Migration20260821090000 renamed this constraint to the credit-facility
    // spelling and back. `up()` leaves the loan spelling, but drop both rather than depend on
    // a rename chain we cannot verify without a live database.
    this.addSql(`alter table "loan_repayment_link" drop constraint if exists "credit_repayment_link_credit_facility_key_transaction_key_unique";`);
    this.addSql(`create unique index concurrently if not exists "loan_repayment_link_active_unique"
      on "loan_repayment_link" ("loan_key", "transaction_key") where "deleted_at" is null;`);

    // Latent, same shape. Additive: the original constraint is left in place, so this only
    // strengthens uniqueness among active rows.
    this.addSql(`create unique index concurrently if not exists "appuser_merchant_category_active_unique"
      on "appuser_merchant_category" ("appuser_key", "transaction_merchant_key", "category_key") where "deleted_at" is null;`);
  }
}
