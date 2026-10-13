import { Migration } from '@mikro-orm/migrations';

export class Migration20260715100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "tenant" add column "recurring_detection_last_run_at" timestamptz null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "tenant" drop column "recurring_detection_last_run_at";');
  }
}
