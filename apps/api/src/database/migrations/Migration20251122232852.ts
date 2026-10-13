import { Migration } from '@mikro-orm/migrations';

export class Migration20251122232852 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "transaction" add constraint "transaction_account_key_nordigen_internal_transaction_id_unique" unique ("account_key", "nordigen_internal_transaction_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "transaction" drop constraint "transaction_account_key_nordigen_internal_transaction_id_unique";`,
    );
  }
}
