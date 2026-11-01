import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { FinancialAsset } from './FinancialAsset';

/**
 * Provenance of a rate-period row: scraped from IGCP's published monthly PDF,
 * derived without a series-specific cross-check, or hand-entered when the scrape
 * is unavailable/wrong.
 */
export enum CertificadoAforroRateSource {
  /**
   * Série C only. Every C/D/E rate is arithmetic on Série F's published
   * figure, but D and E each have a published table that cross-checks the result
   * and C has none — nothing IGCP publishes names Série C at all. So C rides D's
   * gate, which validates D's table rather than C's, and the claim that C uses
   * the C/D/E formula rests on the shared-formula inference alone.
   *
   * Labelling it keeps that limitation attached to the data. Stamping these rows
   * IGCP_PDF_SCRAPE would assert a C-specific scrape that never happened and make the
   * one unconfirmed series indistinguishable from the two that are confirmed.
   */
  IGCP_DERIVED_NO_SERIES_CROSSCHECK = 'IGCP_DERIVED_NO_SERIES_CROSSCHECK',
  IGCP_PDF_SCRAPE = 'IGCP_PDF_SCRAPE',
  MANUAL_OVERRIDE = 'MANUAL_OVERRIDE',
}

/**
 * Monthly base-rate history for a Certificado de Aforro series. One row per
 * (financialAssetKey, effectiveMonth) — the calculation engine reads these to
 * compound the base rate over a subscription's holding period.
 */
@Entity({ tableName: 'certificado_aforro_rate_period' })
@Unique({ name: 'certificado_aforro_rate_period_unique', properties: ['financialAssetKey', 'effectiveMonth'] })
export class CertificadoAforroRatePeriod extends Base {
  @Property({ fieldName: 'base_rate_bps' })
  baseRateBps!: number;

  @PrimaryKey()
  certificadoAforroRatePeriodKey!: number;

  @Property({ columnType: 'date', fieldName: 'effective_month' })
  effectiveMonth!: Date;

  @ManyToOne({ cascade: [], entity: () => FinancialAsset, fieldName: 'financial_asset_key', updateRule: 'cascade' })
  financialAssetKey!: Rel<FinancialAsset>;

  @Enum(() => CertificadoAforroRateSource)
  source: CertificadoAforroRateSource = CertificadoAforroRateSource.IGCP_PDF_SCRAPE;
}
