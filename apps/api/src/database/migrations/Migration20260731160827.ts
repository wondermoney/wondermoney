import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-226 — versioned onboarding bootstrap. Adds two nullable columns to `appuser`
 * recording completion of the first versioned onboarding journey. The columns are
 * nullable on purpose: existing rows (pre-versioning) are treated as
 * "completed v0 / legacy" by the bootstrap endpoint, not as "not yet started".
 *
 * `onboarding_completed_at` is the completion timestamp (the moment the
 * idempotent POST .../onboarding/complete succeeded).
 * `onboarding_completed_version` is the onboarding content version the user
 * completed. A row with a non-current version (after a future content bump)
 * re-prompts the user; legacy completion (no row) is treated as v0 and
 * protected from re-onboarding forever.
 */
export class Migration20260731160827 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "appuser" add column "onboarding_completed_at" timestamptz null;');
    this.addSql('alter table "appuser" add column "onboarding_completed_version" int null;');
    this.addSql('create index "appuser_onboarding_completed_at_index" on "appuser" ("onboarding_completed_at");');
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "appuser_onboarding_completed_at_index";');
    this.addSql('alter table "appuser" drop column if exists "onboarding_completed_version";');
    this.addSql('alter table "appuser" drop column if exists "onboarding_completed_at";');
  }
}
