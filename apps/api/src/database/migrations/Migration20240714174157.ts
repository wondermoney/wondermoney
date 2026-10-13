import { Migration } from '@mikro-orm/migrations';

export class Migration20240714174157 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "transaction" drop constraint "transaction_appuser_transaction_category_appuser__99ef5_foreign";',
    );

    this.addSql(
      'alter table "transaction" drop column "appuser_transaction_category_appuser_transaction_category_key";',
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "transaction" add column "appuser_transaction_category_appuser_transaction_category_key" int null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_appuser_transaction_category_appuser__99ef5_foreign" foreign key ("appuser_transaction_category_appuser_transaction_category_key") references "appuser_transaction_category" ("appuser_transaction_category_key") on delete set null;',
    );
  }
}
