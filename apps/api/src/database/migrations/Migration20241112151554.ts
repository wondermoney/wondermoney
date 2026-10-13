import { Migration } from '@mikro-orm/migrations';

export class Migration20241112151554 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "financial_asset" add column "esg_score" int null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table "financial_asset" drop column "esg_score";');
  }
}
