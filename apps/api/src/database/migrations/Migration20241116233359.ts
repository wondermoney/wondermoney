import { Migration } from '@mikro-orm/migrations';

export class Migration20241116233359 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "transaction_category_stats" alter column "count" type int using ("count"::int);');
    this.addSql('alter table "transaction_category_stats" alter column "count" set default 0;');
  }

  async down(): Promise<void> {
    this.addSql('alter table "transaction_category_stats" alter column "count" drop default;');
    this.addSql('alter table "transaction_category_stats" alter column "count" type int using ("count"::int);');
  }
}
