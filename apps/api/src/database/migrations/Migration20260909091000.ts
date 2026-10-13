import { Migration } from '@mikro-orm/migrations';

/**
 * Creates `enable_banking_connection` (Phase 1a, plan §2), replacing
 * `nordigen_requisition`'s role for Enable Banking's real two-step flow
 * (`POST /auth` → `POST /sessions`). `state` is the correlation value sent on
 * `POST /auth` and echoed back on the callback — the same "reference not id"
 * problem `nordigen_requisition.internal_reference` already solves, so it's
 * unique for the same reason.
 *
 * `access_valid_until` is populated once linked from the *real*
 * provider-returned `access.valid_until` — never a hardcoded offset like
 * `NordigenRequisitionRepository.changeToLinked`'s `addDays(now, 90)`. See
 * `EnableBankingConnectionRepository.changeToLinked`.
 *
 * Purely additive: no existing table/column is touched. `nordigen_requisition`
 * and its FKs are left completely alone.
 */
export class Migration20260909091000 extends Migration {
  override async down(): Promise<void> {
    this.addSql('drop table if exists "enable_banking_connection";');
  }

  override async up(): Promise<void> {
    this.addSql(
      'create table "enable_banking_connection" ("enable_banking_connection_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "enable_banking_credential_key" int not null, "appuser_key" int not null, "tenant_key" int null, "state" varchar(255) not null, "authorization_id" varchar(255) null, "session_id" varchar(255) null, "aspsp_name" varchar(255) not null, "aspsp_country" varchar(2) not null, "status" text check ("status" in (\'created\', \'authorized\', \'linked\', \'error\', \'expired\')) not null default \'created\', "access_valid_until" timestamptz null, "max_consent_validity_seconds" int null);',
    );
    this.addSql(
      'alter table "enable_banking_connection" add constraint "enable_banking_connection_enable_banking_credential_key_foreign" foreign key ("enable_banking_credential_key") references "enable_banking_credential" ("enable_banking_credential_key");',
    );
    this.addSql(
      'alter table "enable_banking_connection" add constraint "enable_banking_connection_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "enable_banking_connection" add constraint "enable_banking_connection_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");',
    );
    this.addSql(
      'alter table "enable_banking_connection" add constraint "enable_banking_connection_state_uindex" unique ("state");',
    );
    this.addSql(
      'create index "enable_banking_connection_tenant_appuser_status_created_at_idx" on "enable_banking_connection" ("tenant_key", "appuser_key", "status", "created_at" desc) where "deleted_at" is null and "tenant_key" is not null;',
    );
  }
}
