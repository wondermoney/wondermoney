import { Migration } from '@mikro-orm/migrations';

/** RAD-25: user-toggled flag to exclude a transaction (e.g. an internal transfer between own accounts) from every calculation. DDL only. */
export class Migration20260803170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "transaction" add column "hidden" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "transaction" drop column "hidden";`);
  }
}
