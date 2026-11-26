import { Migration } from '@mikro-orm/migrations';

export class Migration20261126145107 extends Migration {

  override name = 'Migration20261126145107';

  override up(): void | Promise<void> {
    this.addSql(`alter table "account" add "balance_derived_at" timestamptz null, add "history_window_days" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "account" drop column "balance_derived_at", drop column "history_window_days";`);
  }

}
