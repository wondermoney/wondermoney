import { Migration } from '@mikro-orm/migrations';

export class Migration20261112112841 extends Migration {

  override name = 'Migration20261112112841';

  override up(): void | Promise<void> {
    this.addSql(`create table "loan_rate_period" ("loan_rate_period_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "annual_interest_rate_bps" int not null, "effective_date" date not null, "loan_key" int not null, "tenant_key" int not null);`);
    this.addSql(`create index "loan_rate_period_tenant_key_effective_date_idx" on "loan_rate_period" ("tenant_key", "effective_date");`);
    this.addSql(`create unique index "loan_rate_period_active_loan_effective_date_unique" on "loan_rate_period" ("loan_key", "effective_date") where deleted_at is null;`);

    this.addSql(`alter table "loan" drop constraint "loan_rate_type_check";`);
    this.addSql(`alter table "loan" add constraint "loan_rate_type_check" check ("rate_type" in ('FIXED', 'UNKNOWN', 'VARIABLE'));`);

    this.addSql(`alter table "loan_rate_period" add constraint "loan_rate_period_loan_key_foreign" foreign key ("loan_key") references "loan" ("loan_key");`);
    this.addSql(`alter table "loan_rate_period" add constraint "loan_rate_period_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "loan_rate_period" cascade;`);

    this.addSql(`alter table "loan" drop constraint "loan_rate_type_check";`);
    this.addSql(`alter table "loan" add constraint "loan_rate_type_check" check ("rate_type" in ('FIXED', 'UNKNOWN'));`);
  }

}
