import { Migration } from '@mikro-orm/migrations';

/**
 * Renames the credit module to loans, which is what it is and what we call it.
 *
 * Nothing about the data changes — this is `credit_facility` → `loan`,
 * `credit_facility_key` → `loan_key`, and the same for the two child tables,
 * plus every index, constraint and sequence named after the old word so the
 * schema still matches the entities and the next migration diff comes out
 * empty.
 *
 * `goal.credit_facility_key` moves with it: the column and its foreign key.
 *
 * Renames are metadata-only in Postgres — no table rewrite, no data movement —
 * but they take an ACCESS EXCLUSIVE lock for the duration, so run this with
 * the API stopped rather than against live traffic.
 */
export class Migration20260821090000 extends Migration {
  override async down(): Promise<void> {
    // Sequences.
    this.addSql(`alter sequence if exists "loan_loan_key_seq" rename to "credit_facility_credit_facility_key_seq";`);
    this.addSql(`alter sequence if exists "loan_repayment_link_loan_repayment_link_key_seq" rename to "credit_repayment_link_credit_repayment_link_key_seq";`);
    this.addSql(`alter sequence if exists "loan_adjustment_loan_adjustment_key_seq" rename to "credit_adjustment_credit_adjustment_key_seq";`);

    // Indexes.
    this.addSql(`alter index if exists "loan_adjustment_created_by_idx" rename to "credit_adjustment_created_by_idx";`);
    this.addSql(`alter index if exists "loan_adjustment_loan_key_effective_date_idx" rename to "credit_adjustment_credit_facility_key_effective_date_idx";`);
    this.addSql(`alter index if exists "loan_adjustment_tenant_key_effective_date_idx" rename to "credit_adjustment_tenant_key_effective_date_idx";`);
    this.addSql(`alter index if exists "loan_repayment_link_transaction_idx" rename to "credit_repayment_link_transaction_idx";`);
    this.addSql(`alter index if exists "loan_repayment_link_loan_key_payment_date_idx" rename to "credit_repayment_link_credit_facility_key_payment_date_idx";`);
    this.addSql(`alter index if exists "loan_repayment_link_tenant_key_payment_date_idx" rename to "credit_repayment_link_tenant_key_payment_date_idx";`);
    this.addSql(`alter index if exists "loan_status_idx" rename to "credit_facility_status_idx";`);
    this.addSql(`alter index if exists "loan_tenant_key_owner_appuser_key_idx" rename to "credit_facility_tenant_key_owner_appuser_key_idx";`);
    this.addSql(`alter index if exists "loan_tenant_key_status_idx" rename to "credit_facility_tenant_key_status_idx";`);

    // Constraints.
    this.addSql(`alter table "goal" rename constraint "goal_loan_key_foreign" to "goal_credit_facility_key_foreign";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "loan_adjustment_type_check" to "credit_adjustment_type_check";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "loan_adjustment_created_by_appuser_key_foreign" to "credit_adjustment_created_by_appuser_key_foreign";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "loan_adjustment_loan_key_foreign" to "credit_adjustment_credit_facility_key_foreign";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "loan_adjustment_tenant_key_foreign" to "credit_adjustment_tenant_key_foreign";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "loan_adjustment_pkey" to "credit_adjustment_pkey";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "loan_repayment_link_allocation_source_check" to "credit_repayment_link_allocation_source_check";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "loan_repayment_link_loan_key_transaction_key_unique" to "credit_repayment_link_credit_facility_key_transaction_key_unique";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "loan_repayment_link_linked_by_appuser_key_foreign" to "credit_repayment_link_linked_by_appuser_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "loan_repayment_link_transaction_key_foreign" to "credit_repayment_link_transaction_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "loan_repayment_link_loan_key_foreign" to "credit_repayment_link_credit_facility_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "loan_repayment_link_tenant_key_foreign" to "credit_repayment_link_tenant_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "loan_repayment_link_pkey" to "credit_repayment_link_pkey";`);
    this.addSql(`alter table "loan" rename constraint "loan_payment_frequency_check" to "credit_facility_payment_frequency_check";`);
    this.addSql(`alter table "loan" rename constraint "loan_rate_type_check" to "credit_facility_rate_type_check";`);
    this.addSql(`alter table "loan" rename constraint "loan_status_check" to "credit_facility_status_check";`);
    this.addSql(`alter table "loan" rename constraint "loan_type_check" to "credit_facility_type_check";`);
    this.addSql(`alter table "loan" rename constraint "loan_currency_key_foreign" to "credit_facility_currency_key_foreign";`);
    this.addSql(`alter table "loan" rename constraint "loan_owner_appuser_key_foreign" to "credit_facility_owner_appuser_key_foreign";`);
    this.addSql(`alter table "loan" rename constraint "loan_tenant_key_foreign" to "credit_facility_tenant_key_foreign";`);
    this.addSql(`alter table "loan" rename constraint "loan_pkey" to "credit_facility_pkey";`);

    // Columns.
    this.addSql(`alter table "goal" rename column "loan_key" to "credit_facility_key";`);
    this.addSql(`alter table "loan_adjustment" rename column "loan_key" to "credit_facility_key";`);
    this.addSql(`alter table "loan_adjustment" rename column "loan_adjustment_key" to "credit_adjustment_key";`);
    this.addSql(`alter table "loan_repayment_link" rename column "loan_key" to "credit_facility_key";`);
    this.addSql(`alter table "loan_repayment_link" rename column "loan_repayment_link_key" to "credit_repayment_link_key";`);
    this.addSql(`alter table "loan" rename column "loan_key" to "credit_facility_key";`);

    // Tables.
    this.addSql(`alter table "loan_adjustment" rename to "credit_adjustment";`);
    this.addSql(`alter table "loan_repayment_link" rename to "credit_repayment_link";`);
    this.addSql(`alter table "loan" rename to "credit_facility";`);
  }

  override async up(): Promise<void> {
    // Tables first, so the column renames below name them the new way.
    this.addSql(`alter table "credit_facility" rename to "loan";`);
    this.addSql(`alter table "credit_repayment_link" rename to "loan_repayment_link";`);
    this.addSql(`alter table "credit_adjustment" rename to "loan_adjustment";`);

    // Columns. The primary keys and the two foreign keys that point at the loan.
    this.addSql(`alter table "loan" rename column "credit_facility_key" to "loan_key";`);
    this.addSql(`alter table "loan_repayment_link" rename column "credit_repayment_link_key" to "loan_repayment_link_key";`);
    this.addSql(`alter table "loan_repayment_link" rename column "credit_facility_key" to "loan_key";`);
    this.addSql(`alter table "loan_adjustment" rename column "credit_adjustment_key" to "loan_adjustment_key";`);
    this.addSql(`alter table "loan_adjustment" rename column "credit_facility_key" to "loan_key";`);
    this.addSql(`alter table "goal" rename column "credit_facility_key" to "loan_key";`);

    // Constraints — primary keys, foreign keys, uniques and the enum checks.
    this.addSql(`alter table "loan" rename constraint "credit_facility_pkey" to "loan_pkey";`);
    this.addSql(`alter table "loan" rename constraint "credit_facility_tenant_key_foreign" to "loan_tenant_key_foreign";`);
    this.addSql(`alter table "loan" rename constraint "credit_facility_owner_appuser_key_foreign" to "loan_owner_appuser_key_foreign";`);
    this.addSql(`alter table "loan" rename constraint "credit_facility_currency_key_foreign" to "loan_currency_key_foreign";`);
    this.addSql(`alter table "loan" rename constraint "credit_facility_type_check" to "loan_type_check";`);
    this.addSql(`alter table "loan" rename constraint "credit_facility_status_check" to "loan_status_check";`);
    this.addSql(`alter table "loan" rename constraint "credit_facility_rate_type_check" to "loan_rate_type_check";`);
    this.addSql(`alter table "loan" rename constraint "credit_facility_payment_frequency_check" to "loan_payment_frequency_check";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "credit_repayment_link_pkey" to "loan_repayment_link_pkey";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "credit_repayment_link_tenant_key_foreign" to "loan_repayment_link_tenant_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "credit_repayment_link_credit_facility_key_foreign" to "loan_repayment_link_loan_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "credit_repayment_link_transaction_key_foreign" to "loan_repayment_link_transaction_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "credit_repayment_link_linked_by_appuser_key_foreign" to "loan_repayment_link_linked_by_appuser_key_foreign";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "credit_repayment_link_credit_facility_key_transaction_key_unique" to "loan_repayment_link_loan_key_transaction_key_unique";`);
    this.addSql(`alter table "loan_repayment_link" rename constraint "credit_repayment_link_allocation_source_check" to "loan_repayment_link_allocation_source_check";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "credit_adjustment_pkey" to "loan_adjustment_pkey";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "credit_adjustment_tenant_key_foreign" to "loan_adjustment_tenant_key_foreign";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "credit_adjustment_credit_facility_key_foreign" to "loan_adjustment_loan_key_foreign";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "credit_adjustment_created_by_appuser_key_foreign" to "loan_adjustment_created_by_appuser_key_foreign";`);
    this.addSql(`alter table "loan_adjustment" rename constraint "credit_adjustment_type_check" to "loan_adjustment_type_check";`);
    this.addSql(`alter table "goal" rename constraint "goal_credit_facility_key_foreign" to "goal_loan_key_foreign";`);

    // Plain indexes. `if exists` because these carry no data — a name that
    // drifted in an older environment should not stop the rename.
    this.addSql(`alter index if exists "credit_facility_tenant_key_status_idx" rename to "loan_tenant_key_status_idx";`);
    this.addSql(`alter index if exists "credit_facility_tenant_key_owner_appuser_key_idx" rename to "loan_tenant_key_owner_appuser_key_idx";`);
    this.addSql(`alter index if exists "credit_facility_status_idx" rename to "loan_status_idx";`);
    this.addSql(`alter index if exists "credit_repayment_link_tenant_key_payment_date_idx" rename to "loan_repayment_link_tenant_key_payment_date_idx";`);
    this.addSql(`alter index if exists "credit_repayment_link_credit_facility_key_payment_date_idx" rename to "loan_repayment_link_loan_key_payment_date_idx";`);
    this.addSql(`alter index if exists "credit_repayment_link_transaction_idx" rename to "loan_repayment_link_transaction_idx";`);
    this.addSql(`alter index if exists "credit_adjustment_tenant_key_effective_date_idx" rename to "loan_adjustment_tenant_key_effective_date_idx";`);
    this.addSql(`alter index if exists "credit_adjustment_credit_facility_key_effective_date_idx" rename to "loan_adjustment_loan_key_effective_date_idx";`);
    this.addSql(`alter index if exists "credit_adjustment_created_by_idx" rename to "loan_adjustment_created_by_idx";`);

    // Sequences. The column defaults reference these by OID, so renaming is
    // cosmetic — but leaving them behind is the kind of thing that confuses
    // the next person reading a schema dump.
    this.addSql(`alter sequence if exists "credit_facility_credit_facility_key_seq" rename to "loan_loan_key_seq";`);
    this.addSql(`alter sequence if exists "credit_repayment_link_credit_repayment_link_key_seq" rename to "loan_repayment_link_loan_repayment_link_key_seq";`);
    this.addSql(`alter sequence if exists "credit_adjustment_credit_adjustment_key_seq" rename to "loan_adjustment_loan_adjustment_key_seq";`);
  }
}
