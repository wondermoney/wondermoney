import { Migration } from '@mikro-orm/migrations';

/** Retire the consent ledger feature. DDL only: drops the two consent tables. */
export class Migration20260720000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop table if exists "consent_effective_state" cascade;`);
    this.addSql(`drop table if exists "consent_ledger_entry" cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "consent_ledger_entry" ("consent_ledger_entry_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "action" text check ("action" in ('grant', 'withdraw')) not null, "appuser_key" int not null, "policy_version" varchar(255) not null, "purpose" text check ("purpose" in ('ads', 'analytics', 'lifecycle_email')) not null, "recorded_at" timestamptz not null);`);
    this.addSql(`alter table "consent_ledger_entry" add constraint "consent_ledger_entry_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);

    this.addSql(`create table "consent_effective_state" ("consent_effective_state_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "decided_at" timestamptz not null, "granted" boolean not null, "policy_version" varchar(255) not null, "purpose" text check ("purpose" in ('ads', 'analytics', 'lifecycle_email')) not null);`);
    this.addSql(`alter table "consent_effective_state" add constraint "consent_effective_state_appuser_key_purpose_unique" unique ("appuser_key", "purpose");`);
    this.addSql(`alter table "consent_effective_state" add constraint "consent_effective_state_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
  }
}
