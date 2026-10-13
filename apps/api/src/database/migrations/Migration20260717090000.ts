import { Migration } from '@mikro-orm/migrations';

export class Migration20260717090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "portfolio_import_parser_spec" add column "financial_broker_key" int null, add column "content_hash" varchar(64) null, add column "promoted_at" timestamptz null;');
    this.addSql('alter table "portfolio_import_parser_spec" add constraint "portfolio_import_parser_spec_financial_broker_key_foreign" foreign key ("financial_broker_key") references "financial_broker" ("financial_broker_key") on update cascade on delete set null;');
    this.addSql('create index "portfolio_import_parser_spec_broker_lookup_idx" on "portfolio_import_parser_spec" ("financial_broker_key", "scope", "status", "engine_version", "schema_version", "shape_hash");');
    this.addSql(`create unique index "portfolio_import_parser_spec_active_global_broker_shape_unique" on "portfolio_import_parser_spec" ("financial_broker_key", "engine_version", "schema_version", "shape_hash") where "deleted_at" is null and "status" = 'active' and "scope" = 'global' and "financial_broker_key" is not null;`);
    this.addSql(`create unique index "portfolio_import_parser_spec_active_tenant_broker_shape_unique" on "portfolio_import_parser_spec" ("tenant_key", "financial_broker_key", "engine_version", "schema_version", "shape_hash") where "deleted_at" is null and "status" = 'active' and "scope" = 'tenant' and "financial_broker_key" is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "portfolio_import_parser_spec_active_tenant_broker_shape_unique";');
    this.addSql('drop index if exists "portfolio_import_parser_spec_active_global_broker_shape_unique";');
    this.addSql('drop index if exists "portfolio_import_parser_spec_broker_lookup_idx";');
    this.addSql('alter table "portfolio_import_parser_spec" drop constraint "portfolio_import_parser_spec_financial_broker_key_foreign";');
    this.addSql('alter table "portfolio_import_parser_spec" drop column "financial_broker_key", drop column "content_hash", drop column "promoted_at";');
  }
}
