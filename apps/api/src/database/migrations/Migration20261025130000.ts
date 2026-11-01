import { Migration } from '@mikro-orm/migrations';

/**
 * Drops schema the code no longer uses: the MFA re-enrollment flag, which nothing reads, and a
 * one-off category dedupe backup table that only some databases have.
 */
export class Migration20261025130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "appuser" drop column if exists "requires_mfa_reenrollment";`);
    this.addSql(`drop table if exists "appuser_transaction_category_dedupe_backup_20260530";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "appuser" add column if not exists "requires_mfa_reenrollment" boolean not null default false;`);
  }
}
