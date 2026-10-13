import { Migration } from '@mikro-orm/migrations';

export class Migration20260526120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE "credit_facility" (
        "credit_facility_key" SERIAL PRIMARY KEY,
        "tenant_key" INTEGER NOT NULL,
        "owner_appuser_key" INTEGER NOT NULL,
        "currency_key" INTEGER NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "provider_name" VARCHAR(255),
        "type" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "original_principal" NUMERIC(18, 4),
        "opening_principal_balance" NUMERIC(18, 4) NOT NULL,
        "opening_balance_date" DATE NOT NULL,
        "annual_interest_rate_bps" INTEGER,
        "rate_type" TEXT NOT NULL,
        "regular_payment_amount" NUMERIC(18, 4),
        "payment_frequency" TEXT NOT NULL,
        "payment_day_of_month" INTEGER,
        "term_months" INTEGER,
        "maturity_date" DATE,
        "include_in_net_worth" BOOLEAN NOT NULL DEFAULT TRUE,
        "notes" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "credit_facility_type_check" CHECK ("type" IN ('AUTO_LOAN', 'MORTGAGE', 'OTHER', 'PERSONAL_LOAN', 'STUDENT_LOAN')),
        CONSTRAINT "credit_facility_status_check" CHECK ("status" IN ('ACTIVE', 'CLOSED', 'PAID_OFF')),
        CONSTRAINT "credit_facility_rate_type_check" CHECK ("rate_type" IN ('FIXED', 'UNKNOWN')),
        CONSTRAINT "credit_facility_payment_frequency_check" CHECK ("payment_frequency" IN ('MONTHLY'))
      );
    `);
    this.addSql(`ALTER TABLE "credit_facility" ADD CONSTRAINT "credit_facility_tenant_key_foreign" FOREIGN KEY ("tenant_key") REFERENCES "tenant" ("tenant_key") ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE "credit_facility" ADD CONSTRAINT "credit_facility_owner_appuser_key_foreign" FOREIGN KEY ("owner_appuser_key") REFERENCES "appuser" ("appuser_key") ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE "credit_facility" ADD CONSTRAINT "credit_facility_currency_key_foreign" FOREIGN KEY ("currency_key") REFERENCES "currency" ("currency_key") ON UPDATE CASCADE;`);
    this.addSql(`CREATE INDEX "credit_facility_tenant_key_status_idx" ON "credit_facility" ("tenant_key", "status");`);
    this.addSql(`CREATE INDEX "credit_facility_tenant_key_owner_appuser_key_idx" ON "credit_facility" ("tenant_key", "owner_appuser_key");`);
    this.addSql(`CREATE INDEX "credit_facility_status_idx" ON "credit_facility" ("status");`);

    this.addSql(`
      CREATE TABLE "credit_repayment_link" (
        "credit_repayment_link_key" SERIAL PRIMARY KEY,
        "tenant_key" INTEGER NOT NULL,
        "credit_facility_key" INTEGER NOT NULL,
        "transaction_key" INTEGER NOT NULL,
        "linked_by_appuser_key" INTEGER NOT NULL,
        "payment_date" DATE NOT NULL,
        "total_payment_amount" NUMERIC(18, 4) NOT NULL,
        "principal_amount" NUMERIC(18, 4) NOT NULL,
        "interest_amount" NUMERIC(18, 4) NOT NULL,
        "fee_amount" NUMERIC(18, 4) NOT NULL,
        "allocation_source" TEXT NOT NULL,
        "needs_review" BOOLEAN NOT NULL DEFAULT FALSE,
        "notes" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "credit_repayment_link_allocation_source_check" CHECK ("allocation_source" IN ('AMORTIZATION_ESTIMATE', 'AUTO_MATCHED', 'MANUAL')),
        CONSTRAINT "credit_repayment_link_credit_facility_key_transaction_key_unique" UNIQUE ("credit_facility_key", "transaction_key")
      );
    `);
    this.addSql(`ALTER TABLE "credit_repayment_link" ADD CONSTRAINT "credit_repayment_link_tenant_key_foreign" FOREIGN KEY ("tenant_key") REFERENCES "tenant" ("tenant_key") ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE "credit_repayment_link" ADD CONSTRAINT "credit_repayment_link_credit_facility_key_foreign" FOREIGN KEY ("credit_facility_key") REFERENCES "credit_facility" ("credit_facility_key") ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE "credit_repayment_link" ADD CONSTRAINT "credit_repayment_link_transaction_key_foreign" FOREIGN KEY ("transaction_key") REFERENCES "transaction" ("transaction_key") ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE "credit_repayment_link" ADD CONSTRAINT "credit_repayment_link_linked_by_appuser_key_foreign" FOREIGN KEY ("linked_by_appuser_key") REFERENCES "appuser" ("appuser_key") ON UPDATE CASCADE;`);
    this.addSql(`CREATE INDEX "credit_repayment_link_tenant_key_payment_date_idx" ON "credit_repayment_link" ("tenant_key", "payment_date");`);
    this.addSql(`CREATE INDEX "credit_repayment_link_credit_facility_key_payment_date_idx" ON "credit_repayment_link" ("credit_facility_key", "payment_date");`);
    this.addSql(`CREATE INDEX "credit_repayment_link_transaction_idx" ON "credit_repayment_link" ("transaction_key");`);

    this.addSql(`
      CREATE TABLE "credit_adjustment" (
        "credit_adjustment_key" SERIAL PRIMARY KEY,
        "tenant_key" INTEGER NOT NULL,
        "credit_facility_key" INTEGER NOT NULL,
        "created_by_appuser_key" INTEGER NOT NULL,
        "effective_date" DATE NOT NULL,
        "amount" NUMERIC(18, 4) NOT NULL,
        "type" TEXT NOT NULL,
        "reason" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "credit_adjustment_type_check" CHECK ("type" IN ('BALANCE_CORRECTION', 'CAPITALIZED_INTEREST', 'FEE', 'PRINCIPAL_DECREASE', 'PRINCIPAL_INCREASE', 'WRITE_OFF'))
      );
    `);
    this.addSql(`ALTER TABLE "credit_adjustment" ADD CONSTRAINT "credit_adjustment_tenant_key_foreign" FOREIGN KEY ("tenant_key") REFERENCES "tenant" ("tenant_key") ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE "credit_adjustment" ADD CONSTRAINT "credit_adjustment_credit_facility_key_foreign" FOREIGN KEY ("credit_facility_key") REFERENCES "credit_facility" ("credit_facility_key") ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE "credit_adjustment" ADD CONSTRAINT "credit_adjustment_created_by_appuser_key_foreign" FOREIGN KEY ("created_by_appuser_key") REFERENCES "appuser" ("appuser_key") ON UPDATE CASCADE;`);
    this.addSql(`CREATE INDEX "credit_adjustment_tenant_key_effective_date_idx" ON "credit_adjustment" ("tenant_key", "effective_date");`);
    this.addSql(`CREATE INDEX "credit_adjustment_credit_facility_key_effective_date_idx" ON "credit_adjustment" ("credit_facility_key", "effective_date");`);
    this.addSql(`CREATE INDEX "credit_adjustment_created_by_idx" ON "credit_adjustment" ("created_by_appuser_key");`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "credit_adjustment";`);
    this.addSql(`DROP TABLE IF EXISTS "credit_repayment_link";`);
    this.addSql(`DROP TABLE IF EXISTS "credit_facility";`);
  }
}
