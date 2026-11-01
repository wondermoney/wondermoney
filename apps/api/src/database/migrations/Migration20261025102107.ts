import { Migration } from '@mikro-orm/migrations';

/**
 * Records which client started an Enable Banking connection, so the callback can send the
 * browser back to it. Nullable and additive: a running older API ignores it, and null keeps
 * the web destination.
 */
export class Migration20261025102107 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "enable_banking_connection" add column "return_to" text check ("return_to" in ('mobile')) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "enable_banking_connection" drop column "return_to";`);
  }
}
