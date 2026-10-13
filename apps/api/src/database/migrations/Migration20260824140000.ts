import { Migration } from '@mikro-orm/migrations';

/**
 * Adds a per-code redemption cap to `promocode` (RAD-594).
 *
 * The table had no cap of any kind — no limit column, no counter — so a
 * `CREATOR_1YEAR` code granted a 365-day trial to everyone who ever used it.
 * These codes are published by creators to their audiences, so wide sharing is
 * the intended state; one reaching an aggregator was unlimited free years.
 *
 * `max_redemptions` is nullable and means "uncapped" when null, which keeps the
 * per-user referral codes (`createSignupPromocode`) working exactly as before —
 * they are single-owner by construction and were never the risk.
 *
 * Deliberately no `redemption_count` column. The authoritative count is
 * `appuser.signup_promocode_key`, and a cached counter would be a second source
 * of truth that can drift — most obviously on a retried signup callback, which
 * is idempotent for the appuser but would double-count a naive increment.
 * Counting the real rows cannot drift, and the index below makes it cheap.
 */
export class Migration20260824140000 extends Migration {
  override async down(): Promise<void> {
    this.addSql(`drop index if exists "appuser_signup_promocode_key_idx";`);
    this.addSql(`alter table "promocode" drop column if exists "max_redemptions";`);
  }

  override async up(): Promise<void> {
    this.addSql(`alter table "promocode" add column "max_redemptions" integer null;`);
    this.addSql(`alter table "promocode" add constraint "promocode_max_redemptions_positive_check" check ("max_redemptions" is null or "max_redemptions" > 0);`);
    // The cap is checked on the signup path, so the count runs per promocode
    // signup. Partial: the overwhelming majority of appusers have no promocode.
    this.addSql(`create index if not exists "appuser_signup_promocode_key_idx" on "appuser" ("signup_promocode_key") where "signup_promocode_key" is not null;`);
  }
}
