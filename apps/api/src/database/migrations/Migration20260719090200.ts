import { Migration } from '@mikro-orm/migrations';

export class Migration20260719090200 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "signup_snapshot" add column "route_locale" varchar(2) not null default \'en\';');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "signup_snapshot" drop column "route_locale";');
  }
}
