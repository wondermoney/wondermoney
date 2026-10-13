import { Migration } from '@mikro-orm/migrations';

export class Migration20260730130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "transaction_audit_log" (
        "transaction_audit_log_key" serial primary key,
        "transaction_key" int not null,
        "account_key" int null,
        "appuser_key" int not null,
        "tenant_key" int not null,
        "actor_appuser_key" int null,
        "event_type" text not null,
        "actor_type" text not null,
        "source" varchar(255) null,
        "changes" jsonb null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "transaction_audit_log_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key"),
        constraint "transaction_audit_log_account_key_foreign" foreign key ("account_key") references "account" ("account_key"),
        constraint "transaction_audit_log_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key"),
        constraint "transaction_audit_log_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key"),
        constraint "transaction_audit_log_actor_appuser_key_foreign" foreign key ("actor_appuser_key") references "appuser" ("appuser_key"),
        constraint "transaction_audit_log_event_type_check" check ("event_type" in ('created', 'user_edit', 'system_edit', 'categorized', 'pending_promoted', 'pending_expired', 'dedup_skipped', 'balance_recalc', 'soft_deleted')),
        constraint "transaction_audit_log_actor_type_check" check ("actor_type" in ('user', 'system', 'sync', 'ai'))
      );
    `);
    this.addSql(`create index if not exists "transaction_audit_log_transaction_key_created_at_index" on "transaction_audit_log" ("transaction_key", "created_at");`);
    this.addSql(`create index if not exists "transaction_audit_log_tenant_key_appuser_key_created_at_index" on "transaction_audit_log" ("tenant_key", "appuser_key", "created_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "transaction_audit_log" cascade;`);
  }
}
