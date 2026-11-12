import { Migration } from '@mikro-orm/migrations';

export class Migration20261112174009 extends Migration {

  override name = 'Migration20261112174009';

  override up(): void | Promise<void> {
    this.addSql(`create table "rule_suggestion_dismissal" ("rule_suggestion_dismissal_key" serial primary key, "appuser_key" int not null, "created_at" timestamptz not null, "fingerprint" varchar(64) not null);`);
    this.addSql(`alter table "rule_suggestion_dismissal" add constraint "rule_suggestion_dismissal_appuser_key_fingerprint_unique" unique ("appuser_key", "fingerprint");`);

    this.addSql(`alter table "rule_suggestion_dismissal" add constraint "rule_suggestion_dismissal_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "rule_suggestion_dismissal" cascade;`);
  }

}
