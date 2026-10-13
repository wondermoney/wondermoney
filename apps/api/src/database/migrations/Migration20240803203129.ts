import { Migration } from '@mikro-orm/migrations';

export class Migration20240803203129 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "account" drop constraint "account_account_id_unique";');

    this.addSql(
      'alter table "account" add constraint "account_account_id_account_owner_appuser_key_unique" unique ("account_id", "account_owner_appuser_key");',
    );
  }

  async down(): Promise<void> {
    this.addSql('alter table "account" drop constraint "account_account_id_account_owner_appuser_key_unique";');

    this.addSql('alter table "account" add constraint "account_account_id_unique" unique ("account_id");');
  }
}
