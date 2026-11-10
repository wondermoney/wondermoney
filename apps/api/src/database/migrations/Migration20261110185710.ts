import { Migration } from '@mikro-orm/migrations';

/**
 * Household exchange-rate overrides: `exchange_rate_override` (one household's rate for a pair and
 * day, one live row per household, pair and day) and `exchange_rate_override_audit_log` (who
 * changed it, and how). Two new, empty tables. Additive only.
 */
export class Migration20261110185710 extends Migration {

  override name = 'Migration20261110185710';

  override up(): void | Promise<void> {
    this.addSql(`create table "exchange_rate_override" ("exchange_rate_override_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "created_by_appuser_key" int null, "date" timestamptz not null, "from_currency_key" int not null, "rate" numeric not null, "tenant_key" int not null, "to_currency_key" int not null);`);
    this.addSql(`CREATE UNIQUE INDEX exchange_rate_override_tenant_pair_date_unique ON exchange_rate_override (tenant_key, from_currency_key, to_currency_key, date) WHERE deleted_at IS NULL;`);

    this.addSql(`create table "exchange_rate_override_audit_log" ("exchange_rate_override_audit_log_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "action" text not null, "actor_appuser_key" int null, "changes" jsonb not null, "exchange_rate_override_key" int not null, "tenant_key" int not null);`);
    this.addSql(`create index "exchange_rate_override_audit_log_override_created_idx" on "exchange_rate_override_audit_log" ("exchange_rate_override_key", "created_at");`);

    this.addSql(`alter table "exchange_rate_override" add constraint "exchange_rate_override_created_by_appuser_key_foreign" foreign key ("created_by_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "exchange_rate_override" add constraint "exchange_rate_override_from_currency_key_foreign" foreign key ("from_currency_key") references "currency" ("currency_key");`);
    this.addSql(`alter table "exchange_rate_override" add constraint "exchange_rate_override_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "exchange_rate_override" add constraint "exchange_rate_override_to_currency_key_foreign" foreign key ("to_currency_key") references "currency" ("currency_key");`);

    this.addSql(`alter table "exchange_rate_override_audit_log" add constraint "exchange_rate_override_audit_log_actor_appuser_key_foreign" foreign key ("actor_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "exchange_rate_override_audit_log" add constraint "exchange_rate_override_audit_log_exchange_rate_o_9bc66_foreign" foreign key ("exchange_rate_override_key") references "exchange_rate_override" ("exchange_rate_override_key");`);
    this.addSql(`alter table "exchange_rate_override_audit_log" add constraint "exchange_rate_override_audit_log_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "exchange_rate_override_audit_log" add constraint "exchange_rate_override_audit_log_action_check" check ("action" in ('created', 'deleted', 'updated'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "exchange_rate_override_audit_log" drop constraint "exchange_rate_override_audit_log_exchange_rate_o_9bc66_foreign";`);

    this.addSql(`drop table if exists "exchange_rate_override" cascade;`);
    this.addSql(`drop table if exists "exchange_rate_override_audit_log" cascade;`);
  }

}
