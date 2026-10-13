import { Migration } from '@mikro-orm/migrations';

export class Migration20260524000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE "background_operation" (
        "background_operation_key" SERIAL PRIMARY KEY,
        "tenant_key" INTEGER NULL,
        "appuser_key" INTEGER NULL,
        "operation_type" VARCHAR(100) NOT NULL,
        "resource_id" VARCHAR(255) NOT NULL,
        "status" TEXT NOT NULL,
        "stage" VARCHAR(100) NULL,
        "progress" JSONB NULL,
        "queued_at" TIMESTAMPTZ NULL,
        "started_at" TIMESTAMPTZ NULL,
        "finished_at" TIMESTAMPTZ NULL,
        "last_heartbeat_at" TIMESTAMPTZ NULL,
        "error_code" VARCHAR(100) NULL,
        "retryable" BOOLEAN NOT NULL,
        "correlation_id" VARCHAR(255) NOT NULL,
        "queue_provider" VARCHAR(50) NOT NULL,
        "queue_job_id" VARCHAR(255) NULL,
        "attempt_count" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "background_operation_status_check" CHECK ("status" IN ('queued', 'running', 'partial', 'needs_action', 'succeeded', 'failed', 'stale')),
        CONSTRAINT "background_operation_correlation_id_unique" UNIQUE ("correlation_id")
      );
    `);

    this.addSql(`ALTER TABLE "background_operation" ADD CONSTRAINT "background_operation_tenant_key_foreign" FOREIGN KEY ("tenant_key") REFERENCES "tenant" ("tenant_key") ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE "background_operation" ADD CONSTRAINT "background_operation_appuser_key_foreign" FOREIGN KEY ("appuser_key") REFERENCES "appuser" ("appuser_key") ON UPDATE CASCADE ON DELETE SET NULL;`);

    this.addSql(`CREATE INDEX "background_operation_tenant_status_updated_idx" ON "background_operation" ("tenant_key", "status", "updated_at");`);
    this.addSql(`CREATE INDEX "background_operation_type_resource_idx" ON "background_operation" ("operation_type", "resource_id");`);
    this.addSql(`CREATE UNIQUE INDEX "background_operation_queue_provider_job_id_uindex" ON "background_operation" ("queue_provider", "queue_job_id") WHERE "queue_job_id" IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "background_operation" DROP CONSTRAINT IF EXISTS "background_operation_appuser_key_foreign";`);
    this.addSql(`ALTER TABLE "background_operation" DROP CONSTRAINT IF EXISTS "background_operation_tenant_key_foreign";`);
    this.addSql(`DROP INDEX IF EXISTS "background_operation_queue_provider_job_id_uindex";`);
    this.addSql(`DROP INDEX IF EXISTS "background_operation_type_resource_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "background_operation_tenant_status_updated_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "background_operation";`);
  }
}
