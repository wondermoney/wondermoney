import { Migration } from '@mikro-orm/migrations';

export class Migration20240427152852 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "account_financial_institution" add column "logo_url" varchar(255) null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table "account_financial_institution" drop column "logo_url";');
  }
}
