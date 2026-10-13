import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-414 — per-tenant, per-day reservation counter for the DeepSeek transaction-enrichment
 * pipeline. One row per (tenant, UTC calendar day); the unique (tenant_key, day) constraint is the
 * conflict target for the atomic `reserveTransactionEnrichmentBudget` upsert. DDL only.
 */
export class Migration20260803090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "transaction_enrichment_budget" (
      "transaction_enrichment_budget_key" serial primary key,
      "tenant_key" int not null,
      "day" date not null,
      "reserved_count" int not null default 0,
      "estimated_cost_usd" numeric(18,8) not null default 0,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "transaction_enrichment_budget_reserved_count_check" check ("reserved_count" >= 0),
      constraint "transaction_enrichment_budget_estimated_cost_usd_check" check ("estimated_cost_usd" >= 0)
    );`);

    this.addSql(`alter table "transaction_enrichment_budget" add constraint "transaction_enrichment_budget_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade on delete cascade;`);
    this.addSql(`alter table "transaction_enrichment_budget" add constraint "transaction_enrichment_budget_tenant_key_day_unique" unique ("tenant_key", "day");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "transaction_enrichment_budget" cascade;`);
  }
}
