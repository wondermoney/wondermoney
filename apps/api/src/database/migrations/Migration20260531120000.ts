import { Migration } from '@mikro-orm/migrations';

export class Migration20260531120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "assistant_consent" (
        "assistant_consent_key" serial primary key,
        "appuser_key" int not null,
        "tenant_key" int not null,
        "assistant_enabled" boolean not null default false,
        "enabled_at" timestamptz null,
        "disabled_at" timestamptz null,
        "consent_version" int not null default 1,
        "provider_disclosure_version" int not null default 1,
        "chat_retention_mode" text not null default 'temporary',
        "launcher_hidden" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "assistant_consent_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key"),
        constraint "assistant_consent_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key"),
        constraint "assistant_consent_chat_retention_mode_check" check ("chat_retention_mode" in ('temporary'))
      );
    `);
    this.addSql(`create index if not exists "assistant_consent_tenant_key_appuser_key_index" on "assistant_consent" ("tenant_key", "appuser_key");`);
    this.addSql(
      `create unique index if not exists "assistant_consent_active_uq" on "assistant_consent" ("tenant_key", "appuser_key") where deleted_at is null;`,
    );

    this.addSql(`
      create table if not exists "assistant_audit_log" (
        "assistant_audit_log_key" serial primary key,
        "appuser_key" int not null,
        "tenant_key" int not null,
        "event_type" text not null,
        "conversation_id" varchar(255) not null,
        "tool_name" varchar(255) null,
        "metadata" jsonb null,
        "provider" varchar(255) null,
        "model" varchar(255) null,
        "consent_version" int null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "assistant_audit_log_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key"),
        constraint "assistant_audit_log_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key"),
        constraint "assistant_audit_log_event_type_check" check ("event_type" in ('error', 'response_completed', 'tool_called', 'tool_denied'))
      );
    `);
    this.addSql(`create index if not exists "assistant_audit_log_tenant_key_appuser_key_created_at_index" on "assistant_audit_log" ("tenant_key", "appuser_key", "created_at");`);
    this.addSql(`create index if not exists "assistant_audit_log_conversation_id_index" on "assistant_audit_log" ("conversation_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "assistant_audit_log" cascade;`);
    this.addSql(`drop table if exists "assistant_consent" cascade;`);
  }
}
