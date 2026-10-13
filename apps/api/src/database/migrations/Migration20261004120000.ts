import { Migration } from '@mikro-orm/migrations';

/**
 * Drop the growth-measurement domain: signup snapshots, signed attribution nonces, internal/test
 * user classification, growth milestones and activity facts, and the marketing email capture list.
 * The code that wrote and read them is gone.
 *
 * Also drops the trigger functions their tables used (`drop table` removes a table's triggers but
 * not the functions they call), plus the two the billing drop (Migration20261003000000) left
 * behind.
 *
 * Plain `drop table` (no `cascade`) in dependency order, so an unknown dependency fails loudly;
 * `if exists` so a database that never had a table runs this as a no-op.
 *
 * Irreversible: the rows are deleted, so `down` refuses.
 */
export class Migration20261004120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);

    this.addSql(`drop table if exists "signup_snapshot";`);
    this.addSql(`drop table if exists "appuser_classification";`);
    this.addSql(`drop table if exists "attribution_envelope_nonce";`);
    this.addSql(`drop table if exists "growth_milestone";`);
    this.addSql(`drop table if exists "growth_activity_fact";`);
    this.addSql(`drop table if exists "marketing_email";`);

    this.addSql(`drop function if exists growth_fact_reject_mutation();`);
    this.addSql(`drop function if exists trial_lifecycle_reject_boundary_mutation();`);
    this.addSql(`drop function if exists subscription_reject_trial_anchor_mutation();`);
  }

  override async down(): Promise<void> {
    throw new Error('Migration20261004120000 dropped the growth tables and their data; it cannot be reverted. Restore from a backup instead.');
  }
}
