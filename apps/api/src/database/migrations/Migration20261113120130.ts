import { Migration } from '@mikro-orm/migrations';

/**
 * `transaction.installment_unlinked_plan_key`: the installment plan a member unlinked the row from
 * by hand, so the automatic linker leaves that pair alone. Additive: a nullable column, its foreign
 * key and a partial index.
 */

export class Migration20261113120130 extends Migration {

  override name = 'Migration20261113120130';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transaction" add "installment_unlinked_plan_key" int null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_installment_unlinked_plan_key_foreign" foreign key ("installment_unlinked_plan_key") references "installment_plan" ("installment_plan_key") on delete set null;`);
    this.addSql(`CREATE INDEX transaction_installment_unlinked_plan_index ON "transaction" (installment_unlinked_plan_key) WHERE installment_unlinked_plan_key IS NOT NULL;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction" drop constraint "transaction_installment_unlinked_plan_key_foreign";`);

    this.addSql(`drop index "transaction_installment_unlinked_plan_index";`);
    this.addSql(`alter table "transaction" drop column "installment_unlinked_plan_key";`);
  }

}
