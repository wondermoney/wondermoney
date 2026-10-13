import { Migration } from '@mikro-orm/migrations';

export class Migration20251225000001 extends Migration {
  override async up(): Promise<void> {
    // Create portfolio_snapshot table
    this.addSql(`
      CREATE TABLE "portfolio_snapshot" (
        "portfolio_snapshot_key" SERIAL PRIMARY KEY,
        "portfolio_key" INTEGER NOT NULL REFERENCES "portfolio"("portfolio_key"),
        "snapshot_date" DATE NOT NULL,
        "total_value" NUMERIC(18, 4),
        "cost_basis" NUMERIC(18, 4),
        "currency_key" INTEGER NOT NULL REFERENCES "currency"("currency_key"),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ,
        UNIQUE("portfolio_key", "snapshot_date")
      );
    `);

    // Create index for efficient lookups
    this.addSql(`
      CREATE INDEX "idx_portfolio_snapshot_lookup"
      ON "portfolio_snapshot"("portfolio_key", "snapshot_date" DESC);
    `);

    // Create index for date range queries
    this.addSql(`
      CREATE INDEX "idx_portfolio_snapshot_date"
      ON "portfolio_snapshot"("snapshot_date");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_portfolio_snapshot_date";`);
    this.addSql(`DROP INDEX IF EXISTS "idx_portfolio_snapshot_lookup";`);
    this.addSql(`DROP TABLE IF EXISTS "portfolio_snapshot";`);
  }
}
