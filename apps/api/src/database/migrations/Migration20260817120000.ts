import { Migration } from '@mikro-orm/migrations';

export class Migration20260817120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "subscription" add column "is_lifetime" boolean not null default false;');
    // Partial index: only Founding Member rows matter for the seat-cap count query.
    this.addSql('create index if not exists "subscription_is_lifetime_index" on "subscription" ("is_lifetime") where "is_lifetime" = true;');
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "subscription_is_lifetime_index";');
    this.addSql('alter table "subscription" drop column "is_lifetime";');
  }
}
