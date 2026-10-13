import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the nullable `enable_banking_connection_key` FK to `account` (Phase 1a,
 * plan §2), alongside the existing `nordigen_requisition_key` — not replacing
 * it. Mirrors `account_nordigen_requisition_key_foreign`'s shape exactly
 * (nullable FK, `on delete set null`, so a removed connection just detaches
 * the account rather than blocking or cascading).
 *
 * Purely additive: `nordigen_requisition_key` and its FK are untouched.
 */
export class Migration20260909093000 extends Migration {
  override async down(): Promise<void> {
    this.addSql('alter table "account" drop constraint "account_enable_banking_connection_key_foreign";');
    this.addSql('alter table "account" drop column "enable_banking_connection_key";');
  }

  override async up(): Promise<void> {
    this.addSql('alter table "account" add column "enable_banking_connection_key" int null;');
    this.addSql(
      'alter table "account" add constraint "account_enable_banking_connection_key_foreign" foreign key ("enable_banking_connection_key") references "enable_banking_connection" ("enable_banking_connection_key") on delete set null;',
    );
  }
}
