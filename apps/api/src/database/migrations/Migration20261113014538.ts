import { Migration } from '@mikro-orm/migrations';

export class Migration20261113014538 extends Migration {

  override name = 'Migration20261113014538';

  override up(): void | Promise<void> {
    this.addSql(`alter table "financial_asset_price" add "source" varchar(32) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "financial_asset_price" drop column "source";`);
  }

}
