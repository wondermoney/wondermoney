import { Migration } from '@mikro-orm/migrations';

export class Migration20260308160500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "appuser" add constraint "appuser_external_user_id_unique" unique ("external_user_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "appuser" drop constraint if exists "appuser_external_user_id_unique";`);
  }
}
