import { Migration } from '@mikro-orm/migrations';

export class Migration20261111002021 extends Migration {

  override name = 'Migration20261111002021';

  override up(): void | Promise<void> {
    this.addSql(`create table "bank_connection" ("bank_connection_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "access_valid_until" timestamptz null, "appuser_key" int not null, "credential_reference" varchar(255) null, "external_id" varchar(255) null, "last_sync_attempt_at" timestamptz null, "max_consent_validity_seconds" int null, "next_eligible_sync_at" timestamptz null, "provider" varchar(64) not null, "state" varchar(255) null, "status" text not null default 'created', "tenant_key" int null);`);
    this.addSql(`alter table "bank_connection" add constraint "bank_connection_state_uindex" unique ("state");`);
    this.addSql(`CREATE INDEX bank_connection_tenant_appuser_status_created_at_idx ON bank_connection (tenant_key, appuser_key, status, created_at DESC) WHERE deleted_at IS NULL AND tenant_key IS NOT NULL;`);
    this.addSql(`alter table "bank_connection" add constraint "bank_connection_provider_external_id_unique" unique ("provider", "external_id");`);

    this.addSql(`alter table "account_financial_institution" drop constraint "account_financial_institution_provider_check";`);
    this.addSql(`alter table "account_financial_institution" add constraint "account_financial_institution_provider_check" check ("provider" in ('enable_banking', 'gocardless', 'other'));`);

    this.addSql(`alter table "enable_banking_connection" add "bank_connection_key" int null;`);
    this.addSql(`alter table "enable_banking_connection" add constraint "enable_banking_connection_bank_connection_key_foreign" foreign key ("bank_connection_key") references "bank_connection" ("bank_connection_key") on delete set null;`);
    this.addSql(`alter table "enable_banking_connection" add constraint "enable_banking_connection_bank_connection_uindex" unique ("bank_connection_key");`);

    this.addSql(`alter table "account" add "bank_connection_key" int null;`);
    this.addSql(`alter table "account" add constraint "account_bank_connection_key_foreign" foreign key ("bank_connection_key") references "bank_connection" ("bank_connection_key") on delete set null;`);
    this.addSql(`create index "account_bank_connection_key_index" on "account" ("bank_connection_key");`);

    this.addSql(`alter table "bank_connection" add constraint "bank_connection_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "bank_connection" add constraint "bank_connection_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on delete no action;`);
    this.addSql(`alter table "bank_connection" add constraint "bank_connection_status_check" check ("status" in ('authorized', 'created', 'error', 'expired', 'linked'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "enable_banking_connection" drop constraint "enable_banking_connection_bank_connection_key_foreign";`);
    this.addSql(`alter table "account" drop constraint "account_bank_connection_key_foreign";`);

    this.addSql(`drop table if exists "bank_connection" cascade;`);

    this.addSql(`drop index "account_bank_connection_key_index";`);
    this.addSql(`alter table "account" drop column "bank_connection_key";`);

    this.addSql(`alter table "account_financial_institution" drop constraint "account_financial_institution_provider_check";`);
    this.addSql(`alter table "account_financial_institution" add constraint "account_financial_institution_provider_check" check ("provider" in ('enable_banking', 'gocardless'));`);

    this.addSql(`alter table "enable_banking_connection" drop constraint "enable_banking_connection_bank_connection_uindex";`);
    this.addSql(`alter table "enable_banking_connection" drop column "bank_connection_key";`);
  }

}
