import { Migration } from '@mikro-orm/migrations';

export class Migration20261112173706 extends Migration {

  override name = 'Migration20261112173706';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transaction_merchant" add "logo_url" varchar(2048) null, add "website" varchar(500) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_merchant" drop column "logo_url", drop column "website";`);
  }

}
