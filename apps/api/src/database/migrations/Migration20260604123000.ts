import { Migration } from '@mikro-orm/migrations';

export class Migration20260604123000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "appuser" add column "account_type" varchar(255) not null default \'regular\';');
    this.addSql(
      'alter table "appuser" add constraint "appuser_account_type_check" check ("account_type" in (\'regular\', \'demo\', \'admin\')); ',
    );
    this.addSql('alter table "tenant" add column "tenant_type" varchar(255) not null default \'regular\';');
    this.addSql(
      'alter table "tenant" add constraint "tenant_tenant_type_check" check ("tenant_type" in (\'regular\', \'demo\')); ',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "tenant" drop constraint if exists "tenant_tenant_type_check";');
    this.addSql('alter table "tenant" drop column "tenant_type";');
    this.addSql('alter table "appuser" drop constraint if exists "appuser_account_type_check";');
    this.addSql('alter table "appuser" drop column "account_type";');
  }
}
