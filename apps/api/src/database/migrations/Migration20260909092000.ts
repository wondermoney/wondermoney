import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `provider` to `account_financial_institution` (Phase 1a, plan §2) so
 * Enable Banking institutions (which have no opaque GoCardless-style id) can
 * share the table without colliding on `id`. Every existing row is a
 * GoCardless institution, so they're explicitly backfilled to `'gocardless'`
 * before the column is made `not null` — nothing is left null.
 *
 * The old bare-`id` unique constraint is replaced with a composite
 * `(provider, id)` unique, since a self-constructed Enable Banking id
 * (`enable_banking:{country}:{slug}`) could otherwise collide with a legacy
 * GoCardless id without the discriminator.
 *
 * Purely additive/backfill: no row is deleted, no GoCardless data changes.
 */
export class Migration20260909092000 extends Migration {
  override async down(): Promise<void> {
    this.addSql('alter table "account_financial_institution" drop constraint "account_financial_institution_provider_id_unique";');
    this.addSql('alter table "account_financial_institution" add constraint "account_financial_institution_id_unique" unique ("id");');
    this.addSql('alter table "account_financial_institution" drop constraint "account_financial_institution_provider_check";');
    this.addSql('alter table "account_financial_institution" drop column "provider";');
  }

  override async up(): Promise<void> {
    this.addSql('alter table "account_financial_institution" add column "provider" text null;');
    this.addSql('update "account_financial_institution" set "provider" = \'gocardless\' where "provider" is null;');
    this.addSql('alter table "account_financial_institution" alter column "provider" set default \'gocardless\';');
    this.addSql('alter table "account_financial_institution" alter column "provider" set not null;');
    this.addSql('alter table "account_financial_institution" add constraint "account_financial_institution_provider_check" check ("provider" in (\'gocardless\', \'enable_banking\'));');
    this.addSql('alter table "account_financial_institution" drop constraint "account_financial_institution_id_unique";');
    this.addSql('alter table "account_financial_institution" add constraint "account_financial_institution_provider_id_unique" unique ("provider", "id");');
  }
}
