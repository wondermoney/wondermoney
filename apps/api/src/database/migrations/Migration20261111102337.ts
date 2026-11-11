import { Migration } from '@mikro-orm/migrations';

export class Migration20261111102337 extends Migration {

  override name = 'Migration20261111102337';

  override up(): void | Promise<void> {
    this.addSql(`create table "credit_card_detail" ("account_key" int not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "statement_close_day" int not null, "payment_due_day" int not null, "credit_limit" numeric(18, 4) null, "minimum_payment_percent" numeric(5, 2) null, "tenant_key" int not null, primary key ("account_key"));`);
    this.addSql(`create index "credit_card_detail_tenant_key_index" on "credit_card_detail" ("tenant_key");`);

    this.addSql(`alter table "transaction" add "statement_date_override" date null;`);

    this.addSql(`alter table "credit_card_detail" add constraint "credit_card_detail_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on update cascade on delete cascade;`);
    this.addSql(`alter table "credit_card_detail" add constraint "credit_card_detail_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "credit_card_detail" cascade;`);

    this.addSql(`alter table "transaction" drop column "statement_date_override";`);
  }

}
