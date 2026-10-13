import { Migration } from '@mikro-orm/migrations';

/** RAD-445: data model for Certificados de Aforro (Portuguese savings certificates) as a Portfolio asset type. DDL only. */
export class Migration20260806120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "certificado_aforro_rate_period" ("certificado_aforro_rate_period_key" serial primary key, "financial_asset_key" int not null, "effective_month" date not null, "base_rate_bps" int not null, "source" text not null default 'IGCP_PDF_SCRAPE' check ("source" in ('IGCP_PDF_SCRAPE', 'MANUAL_OVERRIDE')), "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null);`,
    );
    this.addSql(
      `alter table "certificado_aforro_rate_period" add constraint "certificado_aforro_rate_period_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key") on update cascade, add constraint "certificado_aforro_rate_period_unique" unique ("financial_asset_key", "effective_month");`,
    );

    this.addSql(
      `create table "certificado_aforro_premium_schedule" ("certificado_aforro_premium_schedule_key" serial primary key, "financial_asset_key" int not null, "cohort_start_date" date null, "year_from" int not null, "year_to" int null, "premium_bps" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null);`,
    );
    this.addSql(
      `alter table "certificado_aforro_premium_schedule" add constraint "certificado_aforro_premium_schedule_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key") on update cascade;`,
    );
    this.addSql(
      `create index "certificado_aforro_premium_schedule_asset_cohort_idx" on "certificado_aforro_premium_schedule" ("financial_asset_key", "cohort_start_date");`,
    );

    this.addSql(
      `create table "certificado_aforro_subscription_detail" ("transaction_key" int primary key, "tax_exempt" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null);`,
    );
    this.addSql(
      `alter table "certificado_aforro_subscription_detail" add constraint "certificado_aforro_subscription_detail_transaction_key_foreign" foreign key ("transaction_key") references "financial_transaction" ("transaction_key") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "certificado_aforro_subscription_detail" cascade;`);
    this.addSql(`drop table if exists "certificado_aforro_premium_schedule" cascade;`);
    this.addSql(`drop table if exists "certificado_aforro_rate_period" cascade;`);
  }
}
