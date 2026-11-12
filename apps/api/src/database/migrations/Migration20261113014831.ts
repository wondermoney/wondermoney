import { Migration } from '@mikro-orm/migrations';

export class Migration20261113014831 extends Migration {

  override name = 'Migration20261113014831';

  override up(): void | Promise<void> {
    this.addSql(`create table "transaction_reimbursement" ("transaction_reimbursement_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "amount" numeric(18,4) not null, "expense_transaction_key" int not null, "linked_by_appuser_key" int null, "reimbursement_transaction_key" int not null, "tenant_key" int not null);`);
    this.addSql(`CREATE UNIQUE INDEX transaction_reimbursement_pair_live_unique ON transaction_reimbursement (expense_transaction_key, reimbursement_transaction_key) WHERE deleted_at IS NULL;`);
    this.addSql(`create index "transaction_reimbursement_tenant_key_index" on "transaction_reimbursement" ("tenant_key");`);
    this.addSql(`create index "transaction_reimbursement_reimbursement_transaction_key_index" on "transaction_reimbursement" ("reimbursement_transaction_key");`);
    this.addSql(`create index "transaction_reimbursement_expense_transaction_key_index" on "transaction_reimbursement" ("expense_transaction_key");`);

    this.addSql(`alter table "transaction_reimbursement" add constraint "transaction_reimbursement_expense_transaction_key_foreign" foreign key ("expense_transaction_key") references "transaction" ("transaction_key") on delete cascade;`);
    this.addSql(`alter table "transaction_reimbursement" add constraint "transaction_reimbursement_linked_by_appuser_key_foreign" foreign key ("linked_by_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "transaction_reimbursement" add constraint "transaction_reimbursement_reimbursement_transaction_key_foreign" foreign key ("reimbursement_transaction_key") references "transaction" ("transaction_key") on delete cascade;`);
    this.addSql(`alter table "transaction_reimbursement" add constraint "transaction_reimbursement_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "transaction_reimbursement" add constraint "transaction_reimbursement_distinct_sides_check" check ("expense_transaction_key" <> "reimbursement_transaction_key");`);
    this.addSql(`alter table "transaction_reimbursement" add constraint "transaction_reimbursement_amount_positive_check" check ("amount" > 0);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "transaction_reimbursement" cascade;`);
  }

}
