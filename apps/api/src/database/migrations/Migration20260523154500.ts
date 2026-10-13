import { Migration } from '@mikro-orm/migrations';

export class Migration20260523154500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "financial_transaction_portfolio_deleted_date_idx" ON "financial_transaction" ("portfolio_key", "deleted_at", "transaction_date");',
    );
    this.addSql(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "financial_transaction_portfolio_asset_deleted_date_key_idx" ON "financial_transaction" ("portfolio_key", "financial_asset_key", "deleted_at", "transaction_date", "transaction_key");',
    );
    this.addSql(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "financial_asset_price_asset_date_idx" ON "financial_asset_price" ("financial_asset_key", "date");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('DROP INDEX CONCURRENTLY IF EXISTS "financial_asset_price_asset_date_idx";');
    this.addSql('DROP INDEX CONCURRENTLY IF EXISTS "financial_transaction_portfolio_asset_deleted_date_key_idx";');
    this.addSql('DROP INDEX CONCURRENTLY IF EXISTS "financial_transaction_portfolio_deleted_date_idx";');
  }

  override isTransactional(): boolean {
    return false;
  }
}
