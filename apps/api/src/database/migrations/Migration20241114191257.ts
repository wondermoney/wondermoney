import { Migration } from '@mikro-orm/migrations';

export class Migration20241114191257 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "currency" alter column "description" type varchar(255) using ("description"::varchar(255));',
    );
    this.addSql('alter table "currency" alter column "description" drop not null;');
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "currency" alter column "description" type varchar(255) using ("description"::varchar(255));',
    );
    this.addSql('alter table "currency" alter column "description" set not null;');
  }
}
