import { Migration } from '@mikro-orm/migrations';

/**
 * Create the dedicated `better_auth` Postgres schema and better-auth's core tables
 * (RAD-284). better-auth is embedded inside `api` and owns this schema; MikroORM
 * stays confined to `public`, so the two migration tools never collide (same
 * pattern as pg-boss's `pgboss` schema).
 *
 * The DDL is folded verbatim from better-auth 1.6.23's own CLI-generated schema
 * (column names/types/constraints preserved exactly, including its camelCase,
 * quoted identifiers) so the runtime adapter matches what it expects. Statements
 * are idempotent (`if not exists`) so `migration:up` is safe to re-run and never
 * destroys existing auth data. Plugin tables (twoFactor, jwks) arrive in RAD-285.
 *
 * Side effect: MikroORM's `migration:fresh` only drops the entity-mapped `public`
 * schema, so `better_auth` (and its rows) survives a fresh reset and this `up()`
 * no-ops over the still-present tables. Local dev/test needing a truly clean auth
 * state must `drop schema "better_auth" cascade` by hand.
 */
export class Migration20260721120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create schema if not exists "better_auth";`);

    this.addSql(`create table if not exists "better_auth"."user" (
      "id" text not null,
      "name" text not null,
      "email" text not null,
      "emailVerified" boolean not null,
      "image" text null,
      "createdAt" timestamptz not null default current_timestamp,
      "updatedAt" timestamptz not null default current_timestamp,
      constraint "user_pkey" primary key ("id"),
      constraint "user_email_key" unique ("email")
    );`);

    this.addSql(`create table if not exists "better_auth"."session" (
      "id" text not null,
      "expiresAt" timestamptz not null,
      "token" text not null,
      "createdAt" timestamptz not null default current_timestamp,
      "updatedAt" timestamptz not null,
      "ipAddress" text null,
      "userAgent" text null,
      "userId" text not null,
      constraint "session_pkey" primary key ("id"),
      constraint "session_token_key" unique ("token"),
      constraint "session_userId_fkey" foreign key ("userId") references "better_auth"."user" ("id") on delete cascade
    );`);
    this.addSql(`create index if not exists "session_userId_idx" on "better_auth"."session" ("userId");`);

    this.addSql(`create table if not exists "better_auth"."account" (
      "id" text not null,
      "accountId" text not null,
      "providerId" text not null,
      "userId" text not null,
      "accessToken" text null,
      "refreshToken" text null,
      "idToken" text null,
      "accessTokenExpiresAt" timestamptz null,
      "refreshTokenExpiresAt" timestamptz null,
      "scope" text null,
      "password" text null,
      "createdAt" timestamptz not null default current_timestamp,
      "updatedAt" timestamptz not null,
      constraint "account_pkey" primary key ("id"),
      constraint "account_userId_fkey" foreign key ("userId") references "better_auth"."user" ("id") on delete cascade
    );`);
    this.addSql(`create index if not exists "account_userId_idx" on "better_auth"."account" ("userId");`);

    this.addSql(`create table if not exists "better_auth"."verification" (
      "id" text not null,
      "identifier" text not null,
      "value" text not null,
      "expiresAt" timestamptz not null,
      "createdAt" timestamptz not null default current_timestamp,
      "updatedAt" timestamptz not null default current_timestamp,
      constraint "verification_pkey" primary key ("id")
    );`);
    this.addSql(`create index if not exists "verification_identifier_idx" on "better_auth"."verification" ("identifier");`);
  }

  override async down(): Promise<void> {
    // Drops all better-auth tables and the schema itself. `cascade` handles the
    // intra-schema FKs; no `public` object references `better_auth`.
    this.addSql(`drop schema if exists "better_auth" cascade;`);
  }
}
