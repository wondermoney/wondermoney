import { Migration } from '@mikro-orm/migrations';

/**
 * Split transactions (`transaction_split`): the lines one transaction's amount is shared out over,
 * each in its own category. Removed lines are soft-deleted; a line goes with its transaction.
 */
export class Migration20261107223607 extends Migration {

  override name = 'Migration20261107223607';

  override up(): void | Promise<void> {
    this.addSql(`create table "transaction_split" ("transaction_split_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "amount" numeric(18,4) not null, "category_key" int null, "notes" varchar(500) null, "position" int not null, "tenant_key" int not null, "transaction_key" int not null);`);
    this.addSql(`create index "transaction_split_transaction_key_index" on "transaction_split" ("transaction_key");`);

    this.addSql(`alter table "transaction_split" add constraint "transaction_split_category_key_foreign" foreign key ("category_key") references "category" ("category_key") on delete set null;`);
    this.addSql(`alter table "transaction_split" add constraint "transaction_split_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "transaction_split" add constraint "transaction_split_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "transaction_split" cascade;`);
  }

}
