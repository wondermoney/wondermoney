import { Migration } from '@mikro-orm/migrations';

export class Migration20261111104100 extends Migration {

  override name = 'Migration20261111104100';

  override up(): void | Promise<void> {
    this.addSql(`create table "mobile_pairing" ("mobile_pairing_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "code_hash" varchar(64) not null, "expires_at" timestamptz not null, "claimed_at" timestamptz null, "session_id" varchar(64) null, "device_label" varchar(120) null, "revoked_at" timestamptz null);`);
    this.addSql(`alter table "mobile_pairing" add constraint "mobile_pairing_code_hash_unique" unique ("code_hash");`);
    this.addSql(`create index "mobile_pairing_appuser_key_index" on "mobile_pairing" ("appuser_key");`);

    this.addSql(`alter table "mobile_pairing" add constraint "mobile_pairing_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "mobile_pairing" cascade;`);
  }

}
