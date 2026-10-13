import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-342.2 — adds `transaction.categorization_confidence` and
 * `transaction.categorization_reason`. Both are additive and nullable: null means the
 * transaction was never evaluated by the categorizer. `categorization_confidence` is
 * constrained to the `CategorizationConfidence` enum values; `categorization_reason` carries
 * the raw reason code behind that tier (e.g. 'user_mapping', 'stats_tie', 'user_edit').
 */
export class Migration20260802120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "transaction" add column "categorization_confidence" text check ("categorization_confidence" in (\'high\', \'low\', \'medium\', \'none\')) null, add column "categorization_reason" varchar(64) null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "transaction" drop column "categorization_confidence", drop column "categorization_reason";');
  }
}
