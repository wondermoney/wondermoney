import { Migration } from '@mikro-orm/migrations';

export class Migration20261112160856 extends Migration {

  override name = 'Migration20261112160856';

  override up(): void | Promise<void> {
    this.addSql(`alter table "portfolio_import_session" add "import_type" text not null default 'trades';`);
    this.addSql(`alter table "portfolio_import_session" add constraint "portfolio_import_session_import_type_check" check ("import_type" in ('positions', 'trades'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "portfolio_import_session" drop constraint "portfolio_import_session_import_type_check";`);
    this.addSql(`alter table "portfolio_import_session" drop column "import_type";`);
  }

}
