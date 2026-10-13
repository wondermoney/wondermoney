import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-343 (B1) — household_invite table. One pending invite per tenant is the open
 * seat (enforced in app logic, not a DB constraint, since accepted/revoked/expired
 * rows accumulate). Token is globally unique.
 */
export class Migration20260801150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "household_invite" (` +
        `"household_invite_key" serial primary key, ` +
        `"created_at" timestamptz not null, ` +
        `"updated_at" timestamptz not null, ` +
        `"deleted_at" timestamptz null, ` +
        `"accepted_at" timestamptz null, ` +
        `"email_address" varchar(255) not null, ` +
        `"expires_at" timestamptz not null, ` +
        `"inviter_appuser_key" int not null, ` +
        `"status" varchar(255) not null default 'pending', ` +
        `"tenant_key" int not null, ` +
        `"token" text not null` +
        `);`,
    );
    this.addSql(
      `alter table "household_invite" add constraint "household_invite_status_check" check ("status" in ('accepted', 'expired', 'pending', 'revoked'));`,
    );
    this.addSql(`alter table "household_invite" add constraint "household_invite_token_unique" unique ("token");`);
    this.addSql(
      `alter table "household_invite" add constraint "household_invite_inviter_appuser_key_foreign" foreign key ("inviter_appuser_key") references "appuser" ("appuser_key") on update cascade;`,
    );
    this.addSql(
      `alter table "household_invite" add constraint "household_invite_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade;`,
    );
    this.addSql(`create index "household_invite_tenant_key_status_index" on "household_invite" ("tenant_key", "status");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "household_invite" cascade;`);
  }
}
