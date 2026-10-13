import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-346 Phase 3 — re-apply the partial-unique index on (account_key, internal_transaction_id)
 * after the maintenance-window backfill has cleared duplicates.
 *
 * Mirrors the self-guarding block from `Migration20260731010000` (which skipped on prod because
 * duplicates were present). After `rad346-plan-deletions` + `rad346-recompute-balances` have
 * run in the window, this migration is expected to apply the index cleanly. The guard is
 * preserved so this migration is safe to deploy before, during, or after the window — it
 * will only create the index if no duplicates exist, and will otherwise log a warning.
 *
 * The old no-op `(transaction_key, internal_transaction_id)` unique was already dropped by
 * `Migration20260731010000`; nothing to drop here.
 */
export class Migration20260731170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from "transaction"
          where "deleted_at" is null and "internal_transaction_id" is not null
          group by "account_key", "internal_transaction_id" having count(*) > 1
        ) then
          create unique index if not exists "transaction_account_key_internal_transaction_id_unique"
            on "transaction" ("account_key", "internal_transaction_id") where "deleted_at" is null;
          raise notice 'RAD-346 Phase 3 follow-up: applied unique index on (account_key, internal_transaction_id)';
        else
          raise warning 'RAD-346 Phase 3 follow-up: duplicate (account_key, internal_transaction_id) rows present; unique index still skipped — finish remediation then re-deploy';
        end if;
      end $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "transaction_account_key_internal_transaction_id_unique";`);
  }
}
