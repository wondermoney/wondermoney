import { Migration } from '@mikro-orm/migrations';

export class Migration20260718090100 extends Migration {
  override async up(): Promise<void> {
    this.addSql('DROP INDEX CONCURRENTLY IF EXISTS "nordigen_requisition_tenant_appuser_status_created_at_idx";');
    this.addSql(
      'CREATE INDEX CONCURRENTLY "nordigen_requisition_tenant_appuser_status_created_at_idx" ON "nordigen_requisition" ("tenant_key", "appuser_key", "status", "created_at" DESC) WHERE "deleted_at" IS NULL AND "tenant_key" IS NOT NULL;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('DROP INDEX CONCURRENTLY IF EXISTS "nordigen_requisition_tenant_appuser_status_created_at_idx";');
  }

  override isTransactional(): boolean {
    return false;
  }
}
