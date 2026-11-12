import { Migration } from '@mikro-orm/migrations';

export class Migration20261112120943 extends Migration {

  override name = 'Migration20261112120943';

  override up(): void | Promise<void> {
    this.addSql(`alter table "loan" add "secured_asset_key" int null;`);
    this.addSql(`alter table "loan" add constraint "loan_secured_asset_key_foreign" foreign key ("secured_asset_key") references "manual_asset" ("manual_asset_key") on delete set null;`);
    this.addSql(`create index "loan_secured_asset_key_idx" on "loan" ("secured_asset_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "loan" drop constraint "loan_secured_asset_key_foreign";`);

    this.addSql(`drop index "loan_secured_asset_key_idx";`);
    this.addSql(`alter table "loan" drop column "secured_asset_key";`);
  }

}
