/**
 * Idempotent reference-data rollout for Certificados de Aforro (RAD-445/RAD-446).
 *
 * Inserts (once) the `Savings Certificate` `FinancialAssetType` row, the 6 in-scope
 * `FinancialAsset` rows (Séries A/B/C/D/E/F), and — for the two provisioned series, E and F
 * — their loyalty-premium brackets and full published monthly base-rate history. Séries A/B
 * are static-valuation (perpetual, legacy) and have no rate/premium data to seed. Fresh/dev
 * DBs get all of this via `FinancialAssetTypeSeeder` + `FinancialAssetSeeder` +
 * `CertificadoAforroReferenceSeeder` on `pnpm seed:dev`; staging/prod are never re-seeded
 * from scratch, so this script performs the equivalent one-off insert against an
 * already-migrated environment. Safe to re-run: existing rows are left untouched (and a
 * hand-corrected `MANUAL_OVERRIDE` rate row is never clobbered).
 *
 * The premium/rate figures come from the single shared source of truth,
 * `database/constants/certificado-aforro-reference-data.ts` — this script and the seeder
 * read the same constants so the two paths cannot drift.
 *
 * Usage (bootstrap pattern matches `src/database/scripts/verify-tenant-filter.ts` —
 * plain `MikroORM.init(config)`, not the Express app's `app.ts`, since this never
 * touches HTTP/middleware):
 *   NODE_ENV=production pnpm certificado-aforro:seed-lookups
 *   NODE_ENV=development pnpm certificado-aforro:seed-lookups:dev
 *
 * Confirm `.env` targets the intended DB first (see root CLAUDE.md's DB safety
 * rules) — this WRITES.
 */
import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';

import { FINANCIAL_ASSET_TYPE_TO_ASSET_CLASS } from '@app/database/constants/asset-class-rollup';
import {
  CERTIFICADO_AFORRO_PREMIUM_SCHEDULES,
  CERTIFICADO_AFORRO_RATE_HISTORY,
} from '@app/database/constants/certificado-aforro-reference-data';
import config from '@app/mikro-orm.config';
import { AssetClass } from '@entity/AssetClass';
import { CertificadoAforroPremiumSchedule } from '@entity/CertificadoAforroPremiumSchedule';
import { CertificadoAforroRatePeriod, CertificadoAforroRateSource } from '@entity/CertificadoAforroRatePeriod';
import { Currency } from '@entity/Currency';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetType } from '@entity/FinancialAssetType';

const SAVINGS_CERTIFICATE_TYPE_NAME = 'Savings Certificate';

const CA_SERIES = [
  { name: 'Certificado de Aforro — Série A', symbol: 'CA-SERIE-A' },
  { name: 'Certificado de Aforro — Série B', symbol: 'CA-SERIE-B' },
  { name: 'Certificado de Aforro — Série C', symbol: 'CA-SERIE-C' },
  { name: 'Certificado de Aforro — Série D', symbol: 'CA-SERIE-D' },
  { name: 'Certificado de Aforro — Série E', symbol: 'CA-SERIE-E' },
  { name: 'Certificado de Aforro — Série F', symbol: 'CA-SERIE-F' },
];

async function main() {
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();

  try {
    let type = await em.findOne(FinancialAssetType, { name: SAVINGS_CERTIFICATE_TYPE_NAME });
    if (type) {
      console.log(`FinancialAssetType '${SAVINGS_CERTIFICATE_TYPE_NAME}' already present (key=${type.financialAssetTypeKey}), skipping.`);
    } else {
      const assetClassName = FINANCIAL_ASSET_TYPE_TO_ASSET_CLASS[SAVINGS_CERTIFICATE_TYPE_NAME];
      const assetClass = await em.findOneOrFail(AssetClass, { name: assetClassName });
      type = new FinancialAssetType();
      type.assetClassKey = assetClass;
      type.name = SAVINGS_CERTIFICATE_TYPE_NAME;
      em.persist(type);
      await em.flush();
      console.log(`Inserted FinancialAssetType '${SAVINGS_CERTIFICATE_TYPE_NAME}' (key=${type.financialAssetTypeKey}).`);
    }

    const eurCurrency = await em.findOneOrFail(Currency, { code: 'EUR' });

    let created = 0;
    let skipped = 0;
    for (const series of CA_SERIES) {
      const existing = await em.findOne(FinancialAsset, { symbol: series.symbol });
      if (existing) {
        console.log(`FinancialAsset ${series.symbol} already present (key=${existing.financialAssetKey}), skipping.`);
        skipped += 1;
        continue;
      }
      const asset = new FinancialAsset();
      asset.currencyKey = eurCurrency;
      asset.financialAssetTypeKey = type;
      asset.isActivelyTrading = false;
      asset.name = series.name;
      asset.symbol = series.symbol;
      em.persist(asset);
      created += 1;
      console.log(`Inserted FinancialAsset ${series.symbol}.`);
    }
    await em.flush();

    console.log(`FinancialAsset rows: ${created} created, ${skipped} already existed (${CA_SERIES.length} total).`);

    await seedPremiumSchedules(em);
    await seedRateHistory(em);
  } finally {
    await orm.close(true);
  }
}

/** `YYYY-MM-DD` -> midnight UTC, so a re-run in any server timezone lands on the same calendar day. */
function toUtcDate(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

/**
 * Premium brackets, per series. Idempotency is per (asset, cohort) rather than per row: a series'
 * schedule is a set that only makes sense as a whole, so a partially-inserted cohort is worse than
 * either state. If any row already exists for a cohort we leave that cohort entirely alone —
 * including a hand-edited one, which this script must never silently "correct".
 */
async function seedPremiumSchedules(em: EntityManager): Promise<void> {
  for (const [symbol, brackets] of Object.entries(CERTIFICADO_AFORRO_PREMIUM_SCHEDULES)) {
    const asset = await em.findOne(FinancialAsset, { symbol });
    if (!asset) {
      console.log(`Premium schedule for ${symbol}: FinancialAsset row not found, skipping.`);
      continue;
    }

    const cohorts = [...new Set(brackets.map((bracket) => bracket.cohortStartDate))];
    for (const cohort of cohorts) {
      const cohortStartDate = cohort === null ? null : toUtcDate(cohort);
      const existing = await em.count(CertificadoAforroPremiumSchedule, {
        cohortStartDate,
        deletedAt: null,
        financialAssetKey: asset,
      });
      if (existing > 0) {
        console.log(`Premium schedule for ${symbol} (cohort ${cohort ?? 'standard'}): ${existing} row(s) already present, skipping.`);
        continue;
      }

      const rows = brackets.filter((bracket) => bracket.cohortStartDate === cohort);
      for (const bracket of rows) {
        const row = new CertificadoAforroPremiumSchedule();
        row.cohortStartDate = cohortStartDate;
        row.financialAssetKey = asset;
        row.premiumBps = bracket.premiumBps;
        row.yearFrom = bracket.yearFrom;
        row.yearTo = bracket.yearTo;
        em.persist(row);
      }
      await em.flush();
      console.log(`Premium schedule for ${symbol} (cohort ${cohort ?? 'standard'}): inserted ${rows.length} bracket(s).`);
    }
  }
}

/**
 * Historical monthly base rates, per series. Idempotency is per (asset, effectiveMonth) — unlike
 * the premium schedule, months are genuinely independent, so a re-run after a partial failure (or
 * after the daily sync worker has already filled in recent months) fills only the holes.
 *
 * Existing rows are never overwritten. That deliberately protects both a `MANUAL_OVERRIDE` an
 * operator entered and a figure the live worker scraped, either of which is at least as
 * trustworthy as this frozen snapshot.
 */
async function seedRateHistory(em: EntityManager): Promise<void> {
  for (const [symbol, periods] of Object.entries(CERTIFICADO_AFORRO_RATE_HISTORY)) {
    const asset = await em.findOne(FinancialAsset, { symbol });
    if (!asset) {
      console.log(`Rate history for ${symbol}: FinancialAsset row not found, skipping.`);
      continue;
    }

    const existing = await em.find(CertificadoAforroRatePeriod, { financialAssetKey: asset }, { filters: false });
    const existingMonths = new Set(existing.map((row) => row.effectiveMonth.toISOString().slice(0, 10)));

    let inserted = 0;
    for (const period of periods) {
      if (existingMonths.has(period.effectiveMonth)) continue;
      const row = new CertificadoAforroRatePeriod();
      row.baseRateBps = period.baseRateBps;
      row.effectiveMonth = toUtcDate(period.effectiveMonth);
      row.financialAssetKey = asset;
      row.source = CertificadoAforroRateSource.IGCP_PDF_SCRAPE;
      em.persist(row);
      inserted += 1;
    }
    await em.flush();
    console.log(`Rate history for ${symbol}: ${inserted} month(s) inserted, ${periods.length - inserted} already present (${periods.length} total).`);
  }
}

await main();
