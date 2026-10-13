import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-346 Phase 3 — real dedup UNIQUE index on (account_key, internal_transaction_id), applied
 * SAFELY: the index is created only if the data is already free of duplicates; otherwise it logs a
 * warning and skips, so this migration can NEVER fail a prod deploy. Application-level dedup already
 * prevents new duplicates on every ingest path, so skipping here just defers the belt-and-suspenders
 * DB guard until the existing rows are remediated (see the Phase 3 runbook). Also drops the old
 * no-op unique (transaction_key is the PK, so that pair was unique by definition).
 */
export class Migration20260731010000 extends Migration {
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
          raise notice 'RAD-346: applied unique index on (account_key, internal_transaction_id)';
        else
          raise warning 'RAD-346: duplicate (account_key, internal_transaction_id) rows present; unique index skipped — remediate then re-run (see Phase 3 runbook)';
        end if;
      end $$;
    `);
    this.addSql(`alter table "transaction" drop constraint if exists "transaction_transaction_key_internal_transaction_id_unique";`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "transaction_account_key_internal_transaction_id_unique";`);
  }
}
