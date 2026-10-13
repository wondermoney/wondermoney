import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-425 Slice 2 — closed-loop outcome on `transaction_enrichment`: whether the user's eventual
 * category choice matched the model's suggestion (`accepted`) or differed (`overridden`), stamped
 * once when the user categorizes the transaction. Feeds the acceptance-rate metric. DDL only.
 */
export class Migration20260804090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "transaction_enrichment" add column "outcome" text null;`);
    this.addSql(`alter table "transaction_enrichment" add constraint "transaction_enrichment_outcome_check" check ("outcome" is null or "outcome" in ('accepted', 'overridden'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "transaction_enrichment" drop column "outcome";`);
  }
}
