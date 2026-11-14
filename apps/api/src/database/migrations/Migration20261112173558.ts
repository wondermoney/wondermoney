import { Migration } from '@mikro-orm/migrations';

export class Migration20261112173558 extends Migration {

  override name = 'Migration20261112173558';

  override up(): void | Promise<void> {
    this.addSql(`alter table "budget" add "period_start_day" int not null default 1;`);
    this.addSql(`alter table "budget" add constraint "budget_period_start_day_check" check ("period_start_day" between 1 and 28);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "budget" drop constraint "budget_period_start_day_check";`);
    this.addSql(`alter table "budget" drop column "period_start_day";`);
  }

}
