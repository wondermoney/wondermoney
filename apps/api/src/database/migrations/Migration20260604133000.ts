import { Migration } from '@mikro-orm/migrations';

export class Migration20260604133000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "transaction_merchant" add column if not exists "tenant_key" int null;');
    this.addSql('alter table "transaction_merchant" add column if not exists "normalized_name" varchar(255) null;');
    this.addSql('alter table "transaction_merchant" drop constraint if exists "transaction_merchant_name_unique";');
    this.addSql('drop index if exists "transaction_merchant_name_unique";');

    this.addSql('alter table "transaction_merchant" add constraint "transaction_merchant_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade on delete set null;');
    this.addSql('create unique index if not exists "transaction_merchant_tenant_key_normalized_name_active_uq" on "transaction_merchant" ("tenant_key", "normalized_name") where deleted_at is null and "tenant_key" is not null and "normalized_name" is not null;');
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "transaction_merchant_tenant_key_normalized_name_active_uq";');
    this.addSql('alter table "transaction_merchant" drop constraint if exists "transaction_merchant_tenant_key_foreign";');
    this.addSql('alter table "transaction_merchant" drop column if exists "normalized_name";');
    this.addSql('alter table "transaction_merchant" drop column if exists "tenant_key";');
    this.addSql('alter table "transaction_merchant" add constraint "transaction_merchant_name_unique" unique ("name");');
  }
}
