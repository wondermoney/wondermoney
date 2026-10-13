import { Migration } from '@mikro-orm/migrations';

export class Migration20260818090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "referral" add column "reward_granted_at" timestamptz null;');
    this.addSql(`alter table "referral" add column "reward_status" text not null default 'pending';`);
    this.addSql(`alter table "referral" add constraint "referral_reward_status_check" check ("reward_status" in ('pending', 'granted', 'ineligible'));`);
    // The 60-day sweep filters on this pair; keep it cheap to scan as the table grows.
    this.addSql('create index if not exists "referral_reward_sweep_index" on "referral" ("reward_status", "subscription_date") where "reward_status" = \'pending\';');
    this.addSql('alter table "bonus" add column "origin_stripe_discount_code" text null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "bonus" drop column "origin_stripe_discount_code";');
    this.addSql('drop index if exists "referral_reward_sweep_index";');
    this.addSql('alter table "referral" drop constraint "referral_reward_status_check";');
    this.addSql('alter table "referral" drop column "reward_status";');
    this.addSql('alter table "referral" drop column "reward_granted_at";');
  }
}
