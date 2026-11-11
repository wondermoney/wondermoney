import { Migration } from '@mikro-orm/migrations';

export class Migration20261111000140 extends Migration {

  override name = 'Migration20261111000140';

  override up(): void | Promise<void> {
    this.addSql(`alter table "portfolio" add "cost_basis_method" text not null default 'FIFO';`);
    this.addSql(`alter table "portfolio" add constraint "portfolio_cost_basis_method_check" check ("cost_basis_method" in ('AVERAGE', 'FIFO'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "portfolio" drop constraint "portfolio_cost_basis_method_check";`);
    this.addSql(`alter table "portfolio" drop column "cost_basis_method";`);
  }

}
