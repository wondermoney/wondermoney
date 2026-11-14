import { Migration } from '@mikro-orm/migrations';

/**
 * better-auth's passkey table (`@better-auth/passkey`), in the `better_auth` schema beside
 * `twoFactor`, with the column names and types better-auth's own schema generator gives it.
 * `lastUsedAt` is WonderMoney's addition (`services/auth/passkey.ts`).
 *
 * A credential id names one credential, so it is unique across users: the plugin looks a
 * sign-in up by it alone.
 */
export class Migration20261112114242 extends Migration {

  override name = 'Migration20261112114242';

  override up(): void | Promise<void> {
    this.addSql(`create table better_auth.passkey (
    id text not null primary key,
    name text,
    "publicKey" text not null,
    "userId" text not null references better_auth."user" (id) on delete cascade,
    "credentialID" text not null,
    counter integer not null,
    "deviceType" text not null,
    "backedUp" boolean not null,
    transports text,
    "createdAt" timestamp with time zone,
    aaguid text,
    "lastUsedAt" timestamp with time zone
);`);
    this.addSql(`create index "passkey_userId_idx" on better_auth.passkey ("userId");`);
    this.addSql(`create unique index "passkey_credentialID_idx" on better_auth.passkey ("credentialID");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists better_auth.passkey;`);
  }

}
