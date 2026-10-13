import { Migration } from '@mikro-orm/migrations';

export class Migration20260718090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('ALTER TABLE "nordigen_requisition" ADD COLUMN "tenant_key" integer NULL;');
    this.addSql('ALTER TABLE "nordigen_requisition" ADD CONSTRAINT "nordigen_requisition_tenant_key_foreign" FOREIGN KEY ("tenant_key") REFERENCES "tenant" ("tenant_key");');
  }

  override async down(): Promise<void> {
    this.addSql('ALTER TABLE "nordigen_requisition" DROP CONSTRAINT "nordigen_requisition_tenant_key_foreign";');
    this.addSql('ALTER TABLE "nordigen_requisition" DROP COLUMN "tenant_key";');
  }
}
