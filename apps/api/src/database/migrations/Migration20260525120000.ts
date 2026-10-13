import { Migration } from '@mikro-orm/migrations';

export class Migration20260525120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'ALTER TABLE "financial_asset_stock_adjustment" ADD COLUMN IF NOT EXISTS "adjustment_type" varchar(255) NOT NULL DEFAULT \'SPLIT\';',
    );
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ADD COLUMN IF NOT EXISTS "numerator" numeric NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ADD COLUMN IF NOT EXISTS "denominator" numeric NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ADD COLUMN IF NOT EXISTS "source" varchar(255) NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ADD COLUMN IF NOT EXISTS "source_label" varchar(255) NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ALTER COLUMN "dividend" DROP NOT NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ALTER COLUMN "factor" DROP NOT NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ALTER COLUMN "split_ratio" DROP NOT NULL;');
    this.addSql(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "financial_asset_stock_adjustment_asset_date_idx" ON "financial_asset_stock_adjustment" ("financial_asset_key", "date");',
    );
    this.addSql(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "financial_asset_stock_adjustment_split_unique_idx" ON "financial_asset_stock_adjustment" ("financial_asset_key", "date", "numerator", "denominator") WHERE "deleted_at" IS NULL AND "adjustment_type" = \'SPLIT\' AND "numerator" IS NOT NULL AND "denominator" IS NOT NULL;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('DROP INDEX CONCURRENTLY IF EXISTS "financial_asset_stock_adjustment_split_unique_idx";');
    this.addSql('DROP INDEX CONCURRENTLY IF EXISTS "financial_asset_stock_adjustment_asset_date_idx";');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ALTER COLUMN "dividend" SET NOT NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ALTER COLUMN "factor" SET NOT NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" ALTER COLUMN "split_ratio" SET NOT NULL;');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" DROP COLUMN IF EXISTS "source_label";');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" DROP COLUMN IF EXISTS "source";');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" DROP COLUMN IF EXISTS "denominator";');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" DROP COLUMN IF EXISTS "numerator";');
    this.addSql('ALTER TABLE "financial_asset_stock_adjustment" DROP COLUMN IF EXISTS "adjustment_type";');
  }

  override isTransactional(): boolean {
    return false;
  }
}
