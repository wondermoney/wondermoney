import { Migration } from '@mikro-orm/migrations';

export class Migration20241114221902 extends Migration {
  async up(): Promise<void> {
    this.addSql('drop index "isin_unique_not_null";');
  }

  async down(): Promise<void> {
    this.addSql('CREATE UNIQUE INDEX isin_unique_not_null ON financial_asset (isin) WHERE isin IS NOT NULL;');
  }
}
