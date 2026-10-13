import { Migration } from '@mikro-orm/migrations';

export class Migration20260709120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "portfolio_import_session" add column "expired_at" timestamptz null;');
    this.addSql('alter table "portfolio_import_session" alter column "expires_at" set default now() + interval \'7 days\';');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "portfolio_import_session" alter column "expires_at" drop default;');
    this.addSql('alter table "portfolio_import_session" drop column "expired_at";');
  }
}
