import { Migration } from '@mikro-orm/migrations';

/**
 * Widen the lifecycle_delivery.campaign check to allow all six lifecycle tracks
 * (was activation-only). Enables the trial, engagement, data-health, billing and
 * reactivation campaigns to record deliveries in the shared table.
 */
export class Migration20260728010000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "lifecycle_delivery" drop constraint if exists "lifecycle_delivery_campaign_check";`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_campaign_check" check ("campaign" in ('activation', 'billing', 'data_health', 'engagement', 'reactivation', 'trial'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "lifecycle_delivery" drop constraint if exists "lifecycle_delivery_campaign_check";`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_campaign_check" check ("campaign" in ('activation'));`);
  }
}
