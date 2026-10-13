import { Migration } from '@mikro-orm/migrations';

/**
 * Drop the dead `fmt_symbol` column and its `fmt_symbol_unique_not_null`
 * partial-unique index from `financial_asset`. The column was only ever
 * written by `src/database/utils/fmt.ts` (the FMP bulk seeder deleted in
 * commit ac229acf, RAD-449). No readers or writers remain.
 *
 * Down migration is intentionally a no-op except for the
 * `IF EXISTS`/conditional guards: re-introducing the column is a
 * follow-up concern, and the original FMP seeder that populated it is
 * gone.
 */
export class Migration20260805180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('drop index if exists "fmt_symbol_unique_not_null";');
    this.addSql('alter table "financial_asset" drop column if exists "fmt_symbol";');
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "financial_asset" add column if not exists "fmt_symbol" varchar(255) null;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX fmt_symbol_unique_not_null ON financial_asset (fmt_symbol) WHERE fmt_symbol IS NOT NULL;',
    );
  }
}
