import { Migration } from '@mikro-orm/migrations';

/**
 * Committed imports keep a summary: `transaction_import_session` gains `committed_at` (when the
 * commit finished), `details_deleted_at` (when the daily sweep deleted the rows and file) and
 * `row_counts` (the row counts by status, kept with the summary). Three nullable columns. Additive
 * only.
 */
export class Migration20261110171943 extends Migration {

  override name = 'Migration20261110171943';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" add "committed_at" timestamptz null, add "details_deleted_at" timestamptz null, add "row_counts" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" drop column "committed_at", drop column "details_deleted_at", drop column "row_counts";`);
  }

}
