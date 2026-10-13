import { Migration } from '@mikro-orm/migrations';

export class Migration20260804120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "asset_class" ("asset_class_key" serial primary key, "name" varchar(255) not null, "sort_order" int not null);`,
    );
    this.addSql(`alter table "asset_class" add constraint "asset_class_name_unique" unique ("name");`);

    this.addSql(`alter table "financial_asset_type" add column "asset_class_key" int null;`);
    this.addSql(
      `alter table "financial_asset_type" add constraint "financial_asset_type_asset_class_key_foreign" foreign key ("asset_class_key") references "asset_class" ("asset_class_key") on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "financial_asset_type" drop constraint "financial_asset_type_asset_class_key_foreign";`,
    );
    this.addSql(`alter table "financial_asset_type" drop column "asset_class_key";`);
    this.addSql(`drop table if exists "asset_class" cascade;`);
  }
}
