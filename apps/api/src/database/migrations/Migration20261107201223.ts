import { Migration } from '@mikro-orm/migrations';

/**
 * Household tags (`tag`) and the tags on transactions (`transaction_tag`). Tag names are unique
 * per household ignoring case, among live rows.
 */
export class Migration20261107201223 extends Migration {

  override name = 'Migration20261107201223';

  override up(): void | Promise<void> {
    this.addSql(`create table "tag" ("tag_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "color" varchar(7) not null, "created_by_appuser_key" int null, "name" varchar(64) not null, "tenant_key" int not null);`);
    this.addSql(`CREATE UNIQUE INDEX tag_tenant_key_lower_name_unique ON tag (tenant_key, lower(name)) WHERE deleted_at IS NULL;`);

    this.addSql(`create table "transaction_tag" ("transaction_tag_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "tag_key" int not null, "tenant_key" int not null, "transaction_key" int not null);`);
    this.addSql(`create index "transaction_tag_tag_key_index" on "transaction_tag" ("tag_key");`);
    this.addSql(`alter table "transaction_tag" add constraint "transaction_tag_transaction_key_tag_key_unique" unique ("transaction_key", "tag_key");`);

    this.addSql(`alter table "tag" add constraint "tag_created_by_appuser_key_foreign" foreign key ("created_by_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "tag" add constraint "tag_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);

    this.addSql(`alter table "transaction_tag" add constraint "transaction_tag_tag_key_foreign" foreign key ("tag_key") references "tag" ("tag_key") on delete cascade;`);
    this.addSql(`alter table "transaction_tag" add constraint "transaction_tag_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "transaction_tag" add constraint "transaction_tag_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_tag" drop constraint "transaction_tag_tag_key_foreign";`);

    this.addSql(`drop table if exists "tag" cascade;`);
    this.addSql(`drop table if exists "transaction_tag" cascade;`);
  }

}
