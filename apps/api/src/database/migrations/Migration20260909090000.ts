import { Migration } from '@mikro-orm/migrations';

/**
 * Creates `enable_banking_credential` (Phase 1a of the GoCardless → Enable
 * Banking BYOK migration, plan §2). Stores a user's own Enable Banking
 * application registration: `application_id` is not secret (used as the JWT
 * `kid`), while the RSA private key is encrypted at rest via
 * `services/crypto/secret-encryption.service.ts` (AES-256-GCM) and stored as
 * `private_key_ciphertext`/`private_key_iv`/`private_key_auth_tag`, keyed by
 * `encryption_key_version` for future key rotation.
 *
 * No unique constraint on `appuser_key` alone by design — mirrors
 * `nordigen_requisition`, which allows multiple historical rows per user and
 * resolves "the current one" at the application level (status +
 * `created_at DESC`) rather than via a schema constraint. See
 * `EnableBankingCredential.ts` for the full rationale.
 *
 * Purely additive: no existing table/column is touched.
 */
export class Migration20260909090000 extends Migration {
  override async down(): Promise<void> {
    this.addSql('drop table if exists "enable_banking_credential";');
  }

  override async up(): Promise<void> {
    this.addSql(
      'create table "enable_banking_credential" ("enable_banking_credential_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "appuser_key" int not null, "tenant_key" int null, "application_id" varchar(255) not null, "private_key_ciphertext" text not null, "private_key_iv" text not null, "private_key_auth_tag" text not null, "encryption_key_version" int not null, "status" text check ("status" in (\'active\', \'invalid\', \'revoked\')) not null default \'active\', "last_validated_at" timestamptz null, "last_validation_error" text null);',
    );
    this.addSql(
      'alter table "enable_banking_credential" add constraint "enable_banking_credential_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "enable_banking_credential" add constraint "enable_banking_credential_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");',
    );
    this.addSql(
      'create index "enable_banking_credential_appuser_key_status_created_at_index" on "enable_banking_credential" ("appuser_key", "status", "created_at");',
    );
  }
}
