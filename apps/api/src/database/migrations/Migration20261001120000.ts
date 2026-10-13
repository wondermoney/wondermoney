import { Migration } from '@mikro-orm/migrations';

/**
 * Bring `better_auth.jwks` up to better-auth 1.7.6's jwt plugin schema.
 *
 * `Migration20260721130000` folded the jwks table from better-auth 1.6.23's CLI output. 1.7.x
 * added two optional columns, `alg` and `crv`; without them better-auth's startup schema check
 * fails every `/api/auth/*` request with `SCHEMA_MISMATCH`. Both are nullable, so this is a
 * metadata-only change with no table rewrite.
 */
export class Migration20261001120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "better_auth"."jwks" add column if not exists "alg" text null;`);
    this.addSql(`alter table "better_auth"."jwks" add column if not exists "crv" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "better_auth"."jwks" drop column if exists "crv";`);
    this.addSql(`alter table "better_auth"."jwks" drop column if exists "alg";`);
  }
}
