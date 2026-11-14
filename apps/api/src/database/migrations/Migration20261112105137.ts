import { Migration } from '@mikro-orm/migrations';

export class Migration20261112105137 extends Migration {

  override name = 'Migration20261112105137';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" add "file_name" varchar(255) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" drop column "file_name";`);
  }

}
