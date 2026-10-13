import { Migration } from '@mikro-orm/migrations';

/**
 * Drop the billing domain: WonderMoney is free and self-hostable, so subscriptions, trials,
 * Stripe/Moloni invoicing, promocodes, referrals and the paid-acquisition cohort report are gone
 * from the code, and their tables and columns go with them.
 *
 * Plain `drop table` (no `cascade`) in dependency order, so a dependency nobody knew about fails
 * the migration loudly instead of having its foreign key silently dropped. `if exists` because
 * some of these (the trial-feedback tables) were already removed on some databases and a fresh
 * self-hosted install should run this as a no-op.
 *
 * Irreversible: the rows are deleted, so `down` refuses rather than recreating empty tables that
 * would look like a rollback.
 */
export class Migration20261003000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);

    this.addSql(`drop table if exists "referral_reminder_delivery";`);
    this.addSql(`drop table if exists "referral";`);
    this.addSql(`drop table if exists "referral_origin_type";`);
    this.addSql(`drop table if exists "referral_status";`);

    this.addSql(`alter table "appuser" drop column if exists "signup_promocode_key";`);
    this.addSql(`alter table "appuser" drop column if exists "referral_code";`);
    this.addSql(`alter table "appuser" drop column if exists "stripe_customer_id";`);
    this.addSql(`drop table if exists "promocode";`);
    this.addSql(`drop table if exists "bonus";`);
    this.addSql(`drop table if exists "bonus_type";`);

    this.addSql(`drop table if exists "campaign_claim";`);

    this.addSql(`drop table if exists "anonymous_trial_expiry_feedback_response";`);
    this.addSql(`drop table if exists "trial_expiry_feedback_response";`);
    this.addSql(`drop table if exists "trial_lifecycle_delivery";`);
    this.addSql(`drop table if exists "trial_lifecycle_enrollment";`);
    this.addSql(`drop table if exists "trial_lifecycle_treatment_boundary";`);

    this.addSql(`drop table if exists "payment_invoice_error";`);
    this.addSql(`drop table if exists "payment_invoice";`);
    this.addSql(`drop table if exists "stripe_event_fact";`);
    this.addSql(`drop table if exists "stripe_webhook_event";`);
    this.addSql(`drop table if exists "subscription";`);

    this.addSql(`drop table if exists "measurement_cohort";`);

    this.addSql(`alter table "signup_snapshot" drop column if exists "offer_version";`);
    this.addSql(`alter table "signup_snapshot" drop column if exists "trial_days";`);
    this.addSql(`alter table "email_notification_preference" drop column if exists "trial_emails_enabled";`);
  }

  override async down(): Promise<void> {
    throw new Error('Migration20261003000000 dropped the billing tables and their data; it cannot be reverted. Restore from a backup instead.');
  }
}
