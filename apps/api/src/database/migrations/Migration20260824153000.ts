import { Migration } from '@mikro-orm/migrations';

/**
 * Allows `IGCP_DERIVED_NO_SERIES_CROSSCHECK` as a rate-period provenance (RAD-597).
 *
 * Série C rows were stamped `IGCP_PDF_SCRAPE`, which asserts a scrape of a Série C
 * table that does not exist — IGCP never publishes C, not even in the monthly
 * announcement's title. The rate itself is fine (the same arithmetic on Série F's
 * published figure that D and E get), but C is the only series with no table of
 * its own to cross-check against, so it rides D's gate, which validates D's table
 * rather than C's.
 *
 * The label keeps that limitation attached to the data instead of only in a code
 * comment. Without widening this check the worker's next monthly run would fail
 * outright on the C write — the constraint caught exactly that during rollout.
 *
 * Existing Série C rows are relabelled here rather than waiting for the next sync,
 * since until then they would keep asserting a scrape that never happened.
 */
export class Migration20260824153000 extends Migration {
  override async down(): Promise<void> {
    this.addSql(`update "certificado_aforro_rate_period" set "source" = 'IGCP_PDF_SCRAPE' where "source" = 'IGCP_DERIVED_NO_SERIES_CROSSCHECK';`);
    this.addSql(`alter table "certificado_aforro_rate_period" drop constraint if exists "certificado_aforro_rate_period_source_check";`);
    this.addSql(`alter table "certificado_aforro_rate_period" add constraint "certificado_aforro_rate_period_source_check" check ("source" = any (array['IGCP_PDF_SCRAPE'::text, 'MANUAL_OVERRIDE'::text]));`);
  }

  override async up(): Promise<void> {
    this.addSql(`alter table "certificado_aforro_rate_period" drop constraint if exists "certificado_aforro_rate_period_source_check";`);
    this.addSql(`alter table "certificado_aforro_rate_period" add constraint "certificado_aforro_rate_period_source_check" check ("source" = any (array['IGCP_PDF_SCRAPE'::text, 'IGCP_DERIVED_NO_SERIES_CROSSCHECK'::text, 'MANUAL_OVERRIDE'::text]));`);
    // Relabel the rows already written under the old, false provenance. Scoped to
    // Série C by symbol — a hand-entered MANUAL_OVERRIDE must keep its own label.
    this.addSql(`
      update "certificado_aforro_rate_period" rp
      set "source" = 'IGCP_DERIVED_NO_SERIES_CROSSCHECK', "updated_at" = now()
      from "financial_asset" fa
      where fa."financial_asset_key" = rp."financial_asset_key"
        and fa."symbol" = 'CA-SERIE-C'
        and rp."source" = 'IGCP_PDF_SCRAPE';
    `);
  }
}
