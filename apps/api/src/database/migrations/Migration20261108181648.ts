import { Migration } from '@mikro-orm/migrations';

/**
 * A household's own setting for a category, starting with "counts as spending": a system category is
 * one global row shared by every household, so a household's choice for it is kept here. One row
 * per household and category.
 */
export class Migration20261108181648 extends Migration {

  override name = 'Migration20261108181648';

  override up(): void | Promise<void> {
    this.addSql(`create table "tenant_category_setting" ("tenant_category_setting_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "category_key" int not null, "counts_as_spending" boolean not null, "tenant_key" int not null);`);
    this.addSql(`alter table "tenant_category_setting" add constraint "tenant_category_setting_tenant_category_unique" unique ("tenant_key", "category_key");`);

    this.addSql(`alter table "tenant_category_setting" add constraint "tenant_category_setting_category_key_foreign" foreign key ("category_key") references "category" ("category_key");`);
    this.addSql(`alter table "tenant_category_setting" add constraint "tenant_category_setting_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "tenant_category_setting" cascade;`);
  }

}
