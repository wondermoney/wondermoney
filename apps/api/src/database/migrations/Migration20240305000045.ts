import { Migration } from '@mikro-orm/migrations';

export class Migration20240305000045 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "appuser" drop constraint "appuser_emailactivationtoken_uindex";');
    this.addSql('alter table "appuser" drop constraint "appuser_passwordresettoken_uindex";');
    this.addSql('alter table "appuser" drop column "email_activation_token";');
    this.addSql('alter table "appuser" drop column "email_activation_token_date";');
    this.addSql('alter table "appuser" drop column "password_reset_token";');
    this.addSql('alter table "appuser" drop column "password_reset_token_date";');
    this.addSql('alter table "appuser" drop column "twofactor_enabled";');
    this.addSql('alter table "appuser" drop column "twofactor_secret";');
    this.addSql('alter table "appuser" drop column "twofactor_recovery_code";');
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "appuser" add column "email_activation_token" varchar(255) null, add column "email_activation_token_date" timestamptz null, add column "password_reset_token" varchar(255) null, add column "password_reset_token_date" timestamptz null, add column "twofactor_enabled" boolean not null default false, add column "twofactor_secret" varchar(255) null, add column "twofactor_recovery_code" varchar(255) null;',
    );
    this.addSql(
      'alter table "appuser" add constraint "appuser_emailactivationtoken_uindex" unique ("email_activation_token");',
    );
    this.addSql(
      'alter table "appuser" add constraint "appuser_passwordresettoken_uindex" unique ("password_reset_token");',
    );
  }
}
