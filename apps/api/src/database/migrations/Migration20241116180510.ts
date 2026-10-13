import { Migration } from '@mikro-orm/migrations';

export class Migration20241116180510 extends Migration {
  async up(): Promise<void> {
    this.addSql('CREATE INDEX idx_financial_asset_symbol ON financial_asset (symbol);');
  }

  async down(): Promise<void> {
    this.addSql('drop index "idx_financial_asset_symbol";');
  }
}
