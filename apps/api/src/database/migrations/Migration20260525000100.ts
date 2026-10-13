import { Migration } from '@mikro-orm/migrations';

export class Migration20260525000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create unique index if not exists "appuser_transaction_category_active_unique" on "appuser_transaction_category" ("appuser_key", "transaction_key") where "deleted_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "appuser_transaction_category_active_unique";`);
  }
}
