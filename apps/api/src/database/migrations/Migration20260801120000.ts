import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-343 (A1) — Household & Multi-User Support: foundation schema.
 *
 * Adds the columns/constraints the Tenant=Household model needs:
 *  - `appuser_tenant.role` — owner/member. Existing memberships link a user to their
 *    own tenant, so they are backfilled to `owner` (the DB default is the conservative
 *    `member`; the entity default is `owner`, and the invite flow sets `member`).
 *  - `budget.tenant_key` — budgets become household-shared. Added nullable, backfilled
 *    from the owner's tenant, then set NOT NULL.
 *  - `category.tenant_key` — user categories become household-shared. Stays NULLABLE:
 *    system categories (no owner) are global and carry no tenant.
 *  - `account.is_private` — per-account privacy flag (default shared/false).
 *  - one-active-subscription-per-tenant partial unique index (household billing invariant).
 *
 * NOTE: contrary to the "DDL-only" guideline this migration performs one-time backfills
 * (see the UPDATE statements). This matches existing precedent for NOT NULL columns on
 * populated tables — seeders don't run in prod, so the backfill must live here.
 * The subscription unique index assumes at most one non-deleted subscription per tenant
 * today (the signup flow reuses a single row); if prod ever holds duplicates this will
 * fail loudly, which is the desired signal.
 */
export class Migration20260801120000 extends Migration {
  override async up(): Promise<void> {
    // --- appuser_tenant.role -------------------------------------------------
    this.addSql(`alter table "appuser_tenant" add column "role" varchar(255) not null default 'member';`);
    this.addSql(
      `alter table "appuser_tenant" add constraint "appuser_tenant_role_check" check ("role" in ('owner', 'member'));`,
    );
    // Existing memberships own the tenant they link to → owner.
    this.addSql(
      `update "appuser_tenant" at set "role" = 'owner' from "tenant" t where t."tenant_key" = at."tenant_key" and t."owner_appuser_key" = at."appuser_key";`,
    );

    // --- account.is_private --------------------------------------------------
    this.addSql(`alter table "account" add column "is_private" boolean not null default false;`);

    // --- budget.tenant_key (nullable → backfill → not null) ------------------
    this.addSql(`alter table "budget" add column "tenant_key" int null;`);
    this.addSql(
      `alter table "budget" add constraint "budget_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade;`,
    );
    this.addSql(
      `update "budget" b set "tenant_key" = coalesce(` +
        `(select at."tenant_key" from "appuser_tenant" at where at."appuser_key" = b."appuser_key" and at."record_active" = true order by at."appuser_tenant_key" limit 1),` +
        `(select t."tenant_key" from "tenant" t where t."owner_appuser_key" = b."appuser_key" order by t."tenant_key" limit 1)` +
        `) where b."tenant_key" is null;`,
    );
    this.addSql(`alter table "budget" alter column "tenant_key" set not null;`);
    this.addSql(`create index "budget_tenant_key_index" on "budget" ("tenant_key");`);

    // --- category.tenant_key (stays nullable; system categories are global) --
    this.addSql(`alter table "category" add column "tenant_key" int null;`);
    this.addSql(
      `alter table "category" add constraint "category_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade on delete set null;`,
    );
    this.addSql(
      `update "category" c set "tenant_key" = coalesce(` +
        `(select at."tenant_key" from "appuser_tenant" at where at."appuser_key" = c."owner_appuser_key" and at."record_active" = true order by at."appuser_tenant_key" limit 1),` +
        `(select t."tenant_key" from "tenant" t where t."owner_appuser_key" = c."owner_appuser_key" order by t."tenant_key" limit 1)` +
        `) where c."owner_appuser_key" is not null and c."tenant_key" is null;`,
    );
    this.addSql(`create index "category_tenant_key_index" on "category" ("tenant_key");`);

    // --- one active subscription per tenant ----------------------------------
    this.addSql(
      `create unique index "subscription_tenant_key_active_unique" on "subscription" ("tenant_key") where "deleted_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "subscription_tenant_key_active_unique";`);

    this.addSql(`drop index if exists "category_tenant_key_index";`);
    this.addSql(`alter table "category" drop constraint if exists "category_tenant_key_foreign";`);
    this.addSql(`alter table "category" drop column if exists "tenant_key";`);

    this.addSql(`drop index if exists "budget_tenant_key_index";`);
    this.addSql(`alter table "budget" drop constraint if exists "budget_tenant_key_foreign";`);
    this.addSql(`alter table "budget" drop column if exists "tenant_key";`);

    this.addSql(`alter table "account" drop column if exists "is_private";`);

    this.addSql(`alter table "appuser_tenant" drop constraint if exists "appuser_tenant_role_check";`);
    this.addSql(`alter table "appuser_tenant" drop column if exists "role";`);
  }
}
