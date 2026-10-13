import { Migration } from '@mikro-orm/migrations';

export class Migration20260604140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create unique index if not exists "subscription_owner_appuser_key_tenant_key_active_uq" on "subscription" ("owner_appuser_key", "tenant_key") where deleted_at is null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "subscription_owner_appuser_key_tenant_key_active_uq";');
  }
}
