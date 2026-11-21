import { Migration } from '@mikro-orm/migrations';

export class Migration20261121210000 extends Migration {

  override name = 'Migration20261121210000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "appuser" add column "analytics_objected_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appuser" drop column "analytics_objected_at";`);
  }

}
