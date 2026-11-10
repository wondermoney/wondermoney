import { Migration } from '@mikro-orm/migrations';

/**
 * Sync failure classification: `enable_banking_connection.next_eligible_sync_at` keeps the
 * scheduler away from a rate-limited connection until the provider's `Retry-After` has passed, and
 * `bank_sync_incident.retry_after_seconds` records that `Retry-After`. Both nullable, no backfill.
 */
export class Migration20261106225136 extends Migration {

  override name = 'Migration20261106225136';

  override up(): void | Promise<void> {
    this.addSql(`alter table "bank_sync_incident" add "retry_after_seconds" int null;`);

    this.addSql(`alter table "enable_banking_connection" add "next_eligible_sync_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "bank_sync_incident" drop column "retry_after_seconds";`);

    this.addSql(`alter table "enable_banking_connection" drop column "next_eligible_sync_at";`);
  }

}
