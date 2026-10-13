import { Migration } from '@mikro-orm/migrations';

export class Migration20260620190000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "portfolio_import_parser_spec" (
      "portfolio_import_parser_spec_key" serial primary key,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      "appuser_key" int null,
      "tenant_key" int null,
      "supersedes_spec_key" int null,
      "status" text not null default 'active',
      "scope" text not null default 'global',
      "source" text not null default 'llm_confirmed',
      "schema_version" int not null default 1,
      "engine_version" varchar(64) not null,
      "spec_version" int not null default 1,
      "fingerprint_algorithm" varchar(64) not null default 'portfolio-csv-shape-v1',
      "header_order_hash" varchar(64) not null,
      "header_set_hash" varchar(64) not null,
      "shape_hash" varchar(64) not null,
      "normalized_headers_json" jsonb not null,
      "spec_json" jsonb not null,
      "success_count" int not null default 0,
      "failure_count" int not null default 0,
      "last_matched_at" timestamptz null,
      "last_succeeded_at" timestamptz null,
      "last_failed_at" timestamptz null
    );`);
    this.addSql(`alter table "portfolio_import_parser_spec" add constraint "portfolio_import_parser_spec_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on update cascade on delete set null;`);
    this.addSql(`alter table "portfolio_import_parser_spec" add constraint "portfolio_import_parser_spec_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade on delete set null;`);
    this.addSql(`alter table "portfolio_import_parser_spec" add constraint "portfolio_import_parser_spec_supersedes_spec_key_foreign" foreign key ("supersedes_spec_key") references "portfolio_import_parser_spec" ("portfolio_import_parser_spec_key") on update cascade on delete set null;`);
    this.addSql(`alter table "portfolio_import_parser_spec" add constraint "portfolio_import_parser_spec_status_check" check ("status" in ('active', 'deprecated', 'quarantined'));`);
    this.addSql(`alter table "portfolio_import_parser_spec" add constraint "portfolio_import_parser_spec_scope_check" check ("scope" in ('global', 'tenant', 'user'));`);
    this.addSql(`alter table "portfolio_import_parser_spec" add constraint "portfolio_import_parser_spec_source_check" check ("source" in ('admin', 'llm_confirmed', 'user_confirmed'));`);
    this.addSql(`create index "portfolio_import_parser_spec_status_shape_idx" on "portfolio_import_parser_spec" ("status", "shape_hash");`);
    this.addSql(`create index "portfolio_import_parser_spec_status_header_set_idx" on "portfolio_import_parser_spec" ("status", "header_set_hash");`);
    this.addSql(`create index "portfolio_import_parser_spec_scope_idx" on "portfolio_import_parser_spec" ("scope", "tenant_key", "appuser_key");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "portfolio_import_parser_spec" cascade;`);
  }
}
