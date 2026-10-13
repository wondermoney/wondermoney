import { Migration } from '@mikro-orm/migrations';

/** RAD-178 Task 17: versioned, immutable authoritative growth facts. DDL only. */
export class Migration20260719090600 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "growth_activity_fact" add column "version" varchar(255) not null default 'financial_data_view.v1';`);
    this.addSql(`alter table "growth_activity_fact" alter column "version" drop default, drop constraint "growth_activity_fact_appuser_key_utc_day_activity_type_unique", add constraint "growth_activity_fact_user_day_type_version_uq" unique ("appuser_key", "utc_day", "activity_type", "version"), add constraint "growth_activity_fact_never_soft_delete_check" check ("deleted_at" is null);`);
    this.addSql(`alter table "growth_milestone" add constraint "growth_milestone_never_soft_delete_check" check ("deleted_at" is null);`);
    this.addSql(`create function growth_fact_reject_mutation() returns trigger language plpgsql as $$ begin raise exception 'growth facts are immutable'; end $$;`);
    this.addSql(`create trigger growth_activity_fact_immutable before update or delete on "growth_activity_fact" for each row execute function growth_fact_reject_mutation();`);
    this.addSql(`create trigger growth_milestone_immutable before update or delete on "growth_milestone" for each row execute function growth_fact_reject_mutation();`);
    this.addSql(`do $$ begin if exists (select 1 from "referral" where "referral_destination_appuser_key" is not null group by "referral_destination_appuser_key" having count(*) > 1) then raise exception 'RAD-178 referral destination uniqueness preflight failed: duplicate referral_destination_appuser_key rows exist'; end if; end $$;`);
    this.addSql(`create unique index "referral_destination_appuser_key_unique" on "referral" ("referral_destination_appuser_key") where "referral_destination_appuser_key" is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "referral_destination_appuser_key_unique";`);
    this.addSql(`drop trigger if exists growth_milestone_immutable on "growth_milestone"; drop trigger if exists growth_activity_fact_immutable on "growth_activity_fact"; drop function if exists growth_fact_reject_mutation();`);
    this.addSql(`alter table "growth_milestone" drop constraint if exists "growth_milestone_never_soft_delete_check";`);
    this.addSql(`alter table "growth_activity_fact" drop constraint if exists "growth_activity_fact_never_soft_delete_check", drop constraint if exists "growth_activity_fact_user_day_type_version_uq", add constraint "growth_activity_fact_appuser_key_utc_day_activity_type_unique" unique ("appuser_key", "utc_day", "activity_type"), drop column "version";`);
  }
}
