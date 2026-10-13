import { Migration } from '@mikro-orm/migrations';

export class Migration20241112224609 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "financial_asset" add column "logo_url" varchar(255) null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table "financial_asset" drop column "logo_url";');
  }
}
