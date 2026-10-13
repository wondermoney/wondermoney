import { Migration } from '@mikro-orm/migrations';

/** Allow the new `post_trial_feedback` trial-lifecycle step value. DDL only. */
export class Migration20260725130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "trial_lifecycle_delivery" drop constraint if exists "trial_lifecycle_delivery_step_check";`);

    this.addSql(
      `alter table "trial_lifecycle_delivery" add constraint "trial_lifecycle_delivery_step_check" check("step" in ('immediate', 'day_1', 'day_3', 'day_7', 'day_10', 'day_13', 'expiry', 'post_trial_feedback'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "trial_lifecycle_delivery" drop constraint if exists "trial_lifecycle_delivery_step_check";`);

    this.addSql(
      `alter table "trial_lifecycle_delivery" add constraint "trial_lifecycle_delivery_step_check" check("step" in ('immediate', 'day_1', 'day_3', 'day_7', 'day_10', 'day_13', 'expiry'));`,
    );
  }
}
