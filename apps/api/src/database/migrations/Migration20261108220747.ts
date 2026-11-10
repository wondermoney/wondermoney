import { Migration } from '@mikro-orm/migrations';

/**
 * Budget rollover settings: whether a budget row's month takes part in rollover (off for every
 * existing row), and whether a budget carries overspend as well as surplus (on). Adding a column
 * with a constant default does not rewrite the table.
 */
export class Migration20261108220747 extends Migration {

  override name = 'Migration20261108220747';

  override up(): void | Promise<void> {
    this.addSql(`alter table "budget" add "rollover_carries_overspend" boolean not null default true;`);

    this.addSql(`alter table "budget_template_category" add "rollover_enabled" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "budget" drop column "rollover_carries_overspend";`);

    this.addSql(`alter table "budget_template_category" drop column "rollover_enabled";`);
  }

}
