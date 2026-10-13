import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the provider-attempt claim columns to `referral_reminder_delivery`.
 *
 * The referral reminder is contractually a one-shot ("exactly once, ever" per invite),
 * but its worker was a read-status → send → write-status sequence with no lock and no
 * conditional update, on a queue with `retryLimit: 3`. Any failure after Resend accepted
 * the message — including the handler's own deliberate "leave PENDING so pg-boss retries"
 * branch — re-sent it. `lifecycle_delivery` and `bank_recovery_delivery` already carry
 * this machinery; this brings the third delivery table in line.
 *
 * Schema only. `provider_attempt_count` defaults to 0 so existing rows are consistent
 * without any data write.
 */
export class Migration20260915210000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "referral_reminder_delivery" add column "provider_attempt_count" int not null default 0;`);
    this.addSql(`alter table "referral_reminder_delivery" add column "claim_token" uuid null;`);
    this.addSql(`alter table "referral_reminder_delivery" add column "claim_expires_at" timestamptz null;`);
    this.addSql(`alter table "referral_reminder_delivery" add constraint "referral_reminder_delivery_provider_attempt_count_check" check ("provider_attempt_count" between 0 and 2);`);
    // Partial index: the only query that reads these columns is the stale-claim sweep.
    this.addSql(`create index "referral_reminder_delivery_stale_claim_idx" on "referral_reminder_delivery" ("claim_expires_at") where "claim_token" is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "referral_reminder_delivery_stale_claim_idx";`);
    this.addSql(`alter table "referral_reminder_delivery" drop constraint if exists "referral_reminder_delivery_provider_attempt_count_check";`);
    this.addSql(`alter table "referral_reminder_delivery" drop column if exists "claim_expires_at";`);
    this.addSql(`alter table "referral_reminder_delivery" drop column if exists "claim_token";`);
    this.addSql(`alter table "referral_reminder_delivery" drop column if exists "provider_attempt_count";`);
  }

}
