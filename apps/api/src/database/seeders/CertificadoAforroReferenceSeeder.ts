import type { Dictionary, EntityManager } from '@mikro-orm/core';

import {
  CERTIFICADO_AFORRO_PREMIUM_SCHEDULES,
  CERTIFICADO_AFORRO_RATE_HISTORY,
} from '@app/database/constants/certificado-aforro-reference-data';
import { CertificadoAforroPremiumSchedule } from '@entity/CertificadoAforroPremiumSchedule';
import { CertificadoAforroRatePeriod, CertificadoAforroRateSource } from '@entity/CertificadoAforroRatePeriod';
import { FinancialAsset } from '@entity/FinancialAsset';
import { Seeder } from '@mikro-orm/seeder';

/**
 * Seeds the reference data a Certificado de Aforro holding needs in order to be valued at all:
 * each in-scope series' loyalty-premium brackets and its published monthly base-rate
 * history. Without these rows every Savings Certificate lot throws inside the accrual engine and
 * is dropped from the portfolio, so this is not optional colour — it is the difference between the
 * feature working and silently showing nothing.
 *
 * It must run after `FinancialAssetSeeder`, which creates the `CA-SERIE-*` rows this joins to.
 *
 * Only Séries E and F are covered — see the reference-data module for why C and D are deliberately
 * left unprovisioned.
 */
export class CertificadoAforroReferenceSeeder extends Seeder {
  async run(em: EntityManager, _ctx: Dictionary): Promise<void> {
    const symbols = [...new Set([...Object.keys(CERTIFICADO_AFORRO_PREMIUM_SCHEDULES), ...Object.keys(CERTIFICADO_AFORRO_RATE_HISTORY)])];
    const assets = await em.find(FinancialAsset, { symbol: { $in: symbols } });
    const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));

    for (const [symbol, brackets] of Object.entries(CERTIFICADO_AFORRO_PREMIUM_SCHEDULES)) {
      const asset = assetBySymbol.get(symbol);
      if (!asset) continue;
      for (const bracket of brackets) {
        const row = new CertificadoAforroPremiumSchedule();
        row.cohortStartDate = bracket.cohortStartDate === null ? null : new Date(`${bracket.cohortStartDate}T00:00:00.000Z`);
        row.financialAssetKey = asset;
        row.premiumBps = bracket.premiumBps;
        row.yearFrom = bracket.yearFrom;
        row.yearTo = bracket.yearTo;
        em.persist(row);
      }
    }

    for (const [symbol, periods] of Object.entries(CERTIFICADO_AFORRO_RATE_HISTORY)) {
      const asset = assetBySymbol.get(symbol);
      if (!asset) continue;
      for (const period of periods) {
        const row = new CertificadoAforroRatePeriod();
        row.baseRateBps = period.baseRateBps;
        row.effectiveMonth = new Date(`${period.effectiveMonth}T00:00:00.000Z`);
        row.financialAssetKey = asset;
        row.source = CertificadoAforroRateSource.IGCP_PDF_SCRAPE;
        em.persist(row);
      }
    }
  }
}
