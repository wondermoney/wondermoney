import { Migration } from '@mikro-orm/migrations';

export class Migration20260604150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "subscription" drop constraint if exists "subscription_status_check";');
    this.addSql('alter table "subscription" add constraint "subscription_status_check" check ("status" in (\'active\', \'trialing\', \'past_due\', \'paused\', \'canceled\', \'incomplete\', \'incomplete_expired\', \'unknown\', \'unpaid\'));');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "subscription" drop constraint if exists "subscription_status_check";');
    this.addSql('alter table "subscription" add constraint "subscription_status_check" check ("status" in (\'active\', \'trialing\', \'past_due\', \'paused\', \'canceled\', \'incomplete\', \'incomplete_expired\', \'unknown\'));');
  }
}
