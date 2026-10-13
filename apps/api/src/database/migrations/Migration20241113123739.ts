import { Migration } from '@mikro-orm/migrations';

export class Migration20241113123739 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "financial_asset" alter column "esg_score" type numeric using ("esg_score"::numeric);');
  }

  async down(): Promise<void> {
    this.addSql('alter table "financial_asset" alter column "esg_score" type int using ("esg_score"::int);');
  }
}
