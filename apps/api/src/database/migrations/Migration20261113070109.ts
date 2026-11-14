import { Migration } from '@mikro-orm/migrations';

export class Migration20261113070109 extends Migration {

  override name = 'Migration20261113070109';

  override up(): void | Promise<void> {
    this.addSql(`create table "simplefin_connection" ("simplefin_connection_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "access_url_auth_tag" text null, "access_url_ciphertext" text null, "access_url_iv" text null, "appuser_key" int not null, "bank_connection_key" int not null, "encryption_key_version" int null, "institution_id" varchar(255) null, "institution_name" varchar(255) null, "server_host" varchar(255) not null, "tenant_key" int null);`);
    this.addSql(`alter table "simplefin_connection" add constraint "simplefin_connection_bank_connection_uindex" unique ("bank_connection_key");`);

    this.addSql(`alter table "account_financial_institution" drop constraint "account_financial_institution_provider_check";`);
    this.addSql(`alter table "account_financial_institution" add constraint "account_financial_institution_provider_check" check ("provider" in ('enable_banking', 'gocardless', 'other', 'simplefin'));`);

    this.addSql(`alter table "bank_connection" drop constraint "bank_connection_status_check";`);
    this.addSql(`alter table "bank_connection" add constraint "bank_connection_status_check" check ("status" in ('authorized', 'created', 'error', 'expired', 'linked', 'revoked'));`);

    this.addSql(`alter table "simplefin_connection" add constraint "simplefin_connection_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "simplefin_connection" add constraint "simplefin_connection_bank_connection_key_foreign" foreign key ("bank_connection_key") references "bank_connection" ("bank_connection_key");`);
    this.addSql(`alter table "simplefin_connection" add constraint "simplefin_connection_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on delete no action;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "simplefin_connection" cascade;`);

    this.addSql(`alter table "account_financial_institution" drop constraint "account_financial_institution_provider_check";`);
    this.addSql(`alter table "account_financial_institution" add constraint "account_financial_institution_provider_check" check ("provider" in ('enable_banking', 'gocardless', 'other'));`);

    this.addSql(`alter table "bank_connection" drop constraint "bank_connection_status_check";`);
    this.addSql(`alter table "bank_connection" add constraint "bank_connection_status_check" check ("status" in ('authorized', 'created', 'error', 'expired', 'linked'));`);
  }

}
