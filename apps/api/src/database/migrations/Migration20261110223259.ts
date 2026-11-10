import { Migration } from '@mikro-orm/migrations';

/**
 * `enable_banking_connection.last_sync_attempt_at` records when a sync last reached out to the
 * bank, whatever the outcome. The scheduler waits `BANK_SYNC_MIN_INTERVAL_HOURS` from this time,
 * so a failed run also waits out the interval instead of spending another of the PSD2 unattended
 * access calls. Nullable and additive: existing rows fall back to the account's `refreshed_at`.
 */
export class Migration20261110223259 extends Migration {

  override name = 'Migration20261110223259';

  override up(): void | Promise<void> {
    this.addSql(`alter table "enable_banking_connection" add "last_sync_attempt_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "enable_banking_connection" drop column "last_sync_attempt_at";`);
  }

}
