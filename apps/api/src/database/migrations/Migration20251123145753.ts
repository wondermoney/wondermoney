import { Migration } from '@mikro-orm/migrations';

export class Migration20251123145753 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "transaction" drop constraint "transaction_nordigen_internal_transaction_id_unique";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "transaction" add constraint "transaction_nordigen_internal_transaction_id_unique" unique ("nordigen_internal_transaction_id");`,
    );
  }
}
