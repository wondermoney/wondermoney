import { Migration } from '@mikro-orm/migrations';

export class Migration20261112121429 extends Migration {

  override name = 'Migration20261112121429';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" add "category_mapping" jsonb null, add "source_categories" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" drop column "category_mapping", drop column "source_categories";`);
  }

}
