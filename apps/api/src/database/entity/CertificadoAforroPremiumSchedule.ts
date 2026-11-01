import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { FinancialAsset } from './FinancialAsset';

/**
 * Cohort-based loyalty-premium bracket schedule for a Certificado de Aforro series.
 * A series can have multiple cohorts (e.g. Série C's 2009/2012/2014/2015
 * variants), each with its own year-bracketed premium-bps table; `cohortStartDate` is
 * null for series with a single, cohort-independent schedule (e.g. Séries E/F).
 */
@Entity({ tableName: 'certificado_aforro_premium_schedule' })
@Index({ name: 'certificado_aforro_premium_schedule_asset_cohort_idx', properties: ['financialAssetKey', 'cohortStartDate'] })
export class CertificadoAforroPremiumSchedule extends Base {
  @PrimaryKey()
  certificadoAforroPremiumScheduleKey!: number;

  @Property({ columnType: 'date', fieldName: 'cohort_start_date', nullable: true })
  cohortStartDate?: Date | null;

  @ManyToOne({ cascade: [], entity: () => FinancialAsset, fieldName: 'financial_asset_key', updateRule: 'cascade' })
  financialAssetKey!: Rel<FinancialAsset>;

  @Property({ fieldName: 'premium_bps' })
  premiumBps!: number;

  @Property({ fieldName: 'year_from' })
  yearFrom!: number;

  @Property({ fieldName: 'year_to', nullable: true })
  yearTo?: null | number;
}
