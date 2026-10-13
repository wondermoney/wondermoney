import { Migration } from '@mikro-orm/migrations';

/**
 * Add better-auth's plugin-owned schema for the twoFactor and jwt plugins (RAD-285):
 * the `twoFactor` and `jwks` tables plus the `user.twoFactorEnabled` flag. DDL folded
 * verbatim from better-auth 1.6.23's CLI output; idempotent (`if not exists`) and
 * schema-isolated in `better_auth`, matching RAD-284's core-tables migration. The
 * `bearer` plugin needs no schema.
 */
export class Migration20260721130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "better_auth"."twoFactor" (
      "id" text not null,
      "secret" text not null,
      "backupCodes" text not null,
      "userId" text not null,
      "verified" boolean null,
      "failedVerificationCount" integer null,
      "lockedUntil" timestamptz null,
      constraint "twoFactor_pkey" primary key ("id"),
      constraint "twoFactor_userId_fkey" foreign key ("userId") references "better_auth"."user" ("id") on delete cascade
    );`);
    this.addSql(`create index if not exists "twoFactor_secret_idx" on "better_auth"."twoFactor" ("secret");`);
    this.addSql(`create index if not exists "twoFactor_userId_idx" on "better_auth"."twoFactor" ("userId");`);

    this.addSql(`create table if not exists "better_auth"."jwks" (
      "id" text not null,
      "publicKey" text not null,
      "privateKey" text not null,
      "createdAt" timestamptz not null,
      "expiresAt" timestamptz null,
      constraint "jwks_pkey" primary key ("id")
    );`);

    this.addSql(`alter table "better_auth"."user" add column if not exists "twoFactorEnabled" boolean null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "better_auth"."user" drop column if exists "twoFactorEnabled";`);
    this.addSql(`drop table if exists "better_auth"."jwks";`);
    this.addSql(`drop table if exists "better_auth"."twoFactor";`);
  }
}
