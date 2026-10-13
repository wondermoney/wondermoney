import { Migration } from '@mikro-orm/migrations';

export class Migration20260818160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "referral" add column "cash_bonus_status" text not null default 'pending';`);
    this.addSql(`alter table "referral" add constraint "referral_cash_bonus_status_check" check ("cash_bonus_status" in ('pending', 'alerted'));`);
    this.addSql('alter table "referral" add column "cash_bonus_alerted_at" timestamptz null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "referral" drop column "cash_bonus_alerted_at";');
    this.addSql('alter table "referral" drop constraint "referral_cash_bonus_status_check";');
    this.addSql('alter table "referral" drop column "cash_bonus_status";');
  }
}
