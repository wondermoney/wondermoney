import * as Sentry from '@sentry/node';
import { addQuarters } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { DI } from '@app/app';
import logger from '@utils/logger';

vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));
vi.mock('@utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

import { enrichSavingsCertificateHoldings, isSavingsCertificateBatch } from '../certificado-aforro-holdings.service';
import type { HoldingBatch } from '../portfolio-holdings.utils';

const makeBatch = (overrides: Partial<HoldingBatch> = {}): HoldingBatch => ({
  financial_asset_currency_code: 'EUR',
  financial_asset_esg_score: undefined,
  financial_asset_key: 100,
  financial_asset_logo_url: undefined,
  financial_asset_name: 'Certificado de Aforro — Série F',
  financial_asset_symbol: 'CA-SERIE-F',
  financial_asset_type_name: 'Savings Certificate',
  financial_transaction_type_key: 1,
  portfolio_key: 7,
  quantity: 1000,
  remaining_batch: 1000,
  transaction_date: new Date('2024-01-01'),
  transaction_key: 1,
  unit_appuser_amount: undefined,
  unit_settlement_amount: 1,
  ...overrides,
});

interface DatabaseMockData {
  exchangeRateRow?: undefined | { rate: string };
  premiumRows?: Record<string, unknown>[];
  rateRows?: Record<string, unknown>[];
  taxExemptRows?: Record<string, unknown>[];
}

function makeDatabaseMock({ exchangeRateRow, premiumRows = [], rateRows = [], taxExemptRows = [] }: DatabaseMockData) {
  return vi.fn(() => kyselyDouble(({ sql }) => {
    if (sql.includes('from "certificado_aforro_rate_period"')) return rateRows;
    if (sql.includes('from "certificado_aforro_premium_schedule"')) return premiumRows;
    if (sql.includes('from "certificado_aforro_subscription_detail"')) return taxExemptRows;
    if (sql.includes('from "exchange_rate"')) return exchangeRateRow ? [exchangeRateRow] : [];
    return [];
  }).db);
}

// A standard-cohort premium schedule with a single bracket applying from year 1 onward, so
// resolvePremiumBrackets never throws for any subscription date used in this suite unless noted.
const standardPremiumRows = [{ cohort_start_date: null, financial_asset_key: 100, premium_bps: 25, year_from: 1, year_to: null }];
// A wide rate-period history so any quarter start in this suite resolves without needing fallback.
const wideRateRows = [
  { base_rate_bps: 250, effective_month: '2024-01-01', financial_asset_key: 100 },
  { base_rate_bps: 250, effective_month: '2024-04-01', financial_asset_key: 100 },
  { base_rate_bps: 250, effective_month: '2024-07-01', financial_asset_key: 100 },
  { base_rate_bps: 250, effective_month: '2024-10-01', financial_asset_key: 100 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isSavingsCertificateBatch', () => {
  it('returns true only for the Savings Certificate asset type', () => {
    expect(isSavingsCertificateBatch(makeBatch())).toBe(true);
    expect(isSavingsCertificateBatch(makeBatch({ financial_asset_type_name: 'Stock' }))).toBe(false);
  });
});

describe('enrichSavingsCertificateHoldings', () => {
  it('returns no holdings when there are no open batches', async () => {
    Object.assign(DI.em, { getKysely: makeDatabaseMock({}) });

    const result = await enrichSavingsCertificateHoldings([], 'EUR');

    expect(result).toEqual([]);
  });

  it('sums multiple lots of the same series with different subscription dates and taxExempt values into one holding', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        premiumRows: standardPremiumRows,
        rateRows: wideRateRows,
        taxExemptRows: [{ tax_exempt: true, transaction_key: 1 }],
      }),
    });

    const batches = [
      makeBatch({ remaining_batch: 1000, transaction_date: new Date('2024-01-01'), transaction_key: 1 }),
      makeBatch({ remaining_batch: 500, transaction_date: new Date('2024-04-01'), transaction_key: 2 }),
    ];

    const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-01'));

    expect(result).toHaveLength(1);
    const holding = result[0]!;
    expect(holding.quantity).toBe(1500);
    expect(holding.financialAssetSymbol).toBe('CA-SERIE-F');
    expect(holding.currentValue).toBeGreaterThan(1500); // interest accrued
    expect(holding.relatedTransactionKeys).toEqual([1, 2]);
    expect(holding.certificadoAforroDetail).toBeDefined();
    expect(holding.certificadoAforroDetail!.lots).toHaveLength(2);
    expect(holding.certificadoAforroDetail!.lots.map((l) => l.taxExempt)).toEqual([true, false]);
  });

  it('skips a lot with no matching series constants, warns, and does not throw', async () => {
    Object.assign(DI.em, { getKysely: makeDatabaseMock({ premiumRows: standardPremiumRows, rateRows: wideRateRows }) });

    const batches = [makeBatch({ financial_asset_key: 999, financial_asset_symbol: 'CA-SERIE-UNKNOWN' })];

    const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-01'));

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'CA-SERIE-UNKNOWN' }),
      expect.stringContaining('No series constants'),
    );
  });

  it('skips a lot that fails valuation (empty rate periods) without throwing, and other assets still value', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        // No rate periods at all for financial_asset_key 100 (Série F) or 200 (Série C) — a real
        // implementation would branch by asset key, but this suite deliberately supplies the SAME
        // (empty) rate rows for both assets in this test, then relies on 200 succeeding because it
        // gets its own valid rows below.
        premiumRows: [
          { cohort_start_date: null, financial_asset_key: 100, premium_bps: 25, year_from: 1, year_to: null },
          { cohort_start_date: null, financial_asset_key: 200, premium_bps: 25, year_from: 1, year_to: null },
        ],
        rateRows: [
          // Only Série C (asset 200) has published rate periods; Série F (asset 100) has none,
          // so its lot must throw inside computeCertificateLotValue (no rate period at all).
          { base_rate_bps: 350, effective_month: '2024-01-01', financial_asset_key: 200 },
        ],
        taxExemptRows: [],
      }),
    });

    const brokenBatch = makeBatch({
      financial_asset_key: 100,
      financial_asset_symbol: 'CA-SERIE-F',
      remaining_batch: 1000,
      transaction_date: new Date('2024-01-01'),
      transaction_key: 1,
    });
    const healthyBatch = makeBatch({
      financial_asset_key: 200,
      financial_asset_name: 'Certificado de Aforro — Série C',
      financial_asset_symbol: 'CA-SERIE-C',
      remaining_batch: 2000,
      transaction_date: new Date('2024-01-01'),
      transaction_key: 2,
    });

    const result = await enrichSavingsCertificateHoldings([brokenBatch, healthyBatch], 'EUR', new Date('2025-01-01'));

    expect(result).toHaveLength(1);
    expect(result[0]!.financialAssetSymbol).toBe('CA-SERIE-C');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'CA-SERIE-F', transactionKey: 1 }),
      expect.stringContaining('Failed to value Savings Certificate lot'),
    );
  });

  it('skips only the failing lot within a holding that has a mix of valid and invalid lots', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        // Cohort only covers subscriptions from 2020 onward — a lot subscribed in 2015 will fail
        // resolvePremiumBrackets (no applicable cohort), the 2024 lot succeeds.
        premiumRows: [{ cohort_start_date: '2020-01-01', financial_asset_key: 100, premium_bps: 25, year_from: 1, year_to: null }],
        rateRows: wideRateRows,
        taxExemptRows: [],
      }),
    });

    const batches = [
      makeBatch({ remaining_batch: 1000, transaction_date: new Date('2015-01-01'), transaction_key: 1 }),
      makeBatch({ remaining_batch: 500, transaction_date: new Date('2024-01-01'), transaction_key: 2 }),
    ];

    const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-01'));

    expect(result).toHaveLength(1);
    const holding = result[0]!;
    // Only the 2024 lot (500) contributed — the 2015 lot (1000) was skipped.
    expect(holding.quantity).toBe(500);
    expect(holding.certificadoAforroDetail!.lots).toHaveLength(1);
    expect(holding.certificadoAforroDetail!.lots[0]!.transactionKey).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ transactionKey: 1 }),
      expect.stringContaining('Failed to value Savings Certificate lot'),
    );
  });

  it('alerts Sentry (not just the log) when EVERY lot of a holding fails to value, tagging the series', async () => {
    Object.assign(DI.em, {
      // No premium schedule and no rate periods at all — exactly the Séries C/D provisioning gap.
      getKysely: makeDatabaseMock({ premiumRows: [], rateRows: [] }),
    });

    const batches = [
      makeBatch({ financial_asset_key: 200, financial_asset_symbol: 'CA-SERIE-C', transaction_key: 1 }),
      makeBatch({ financial_asset_key: 200, financial_asset_symbol: 'CA-SERIE-C', transaction_key: 2 }),
    ];

    const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-01'));

    expect(result).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = vi.mocked(Sentry.captureMessage).mock.calls[0]!;
    // The symbol must appear in the message AND as a tag: Séries C/D are a known, deliberate
    // provisioning gap, so a triager has to be able to tell those apart from an E/F failure —
    // which would be a real regression — without reading the code.
    expect(message).toContain('CA-SERIE-C');
    expect(message).toMatch(/provisioning gap/i);
    expect(context).toMatchObject({
      extra: expect.objectContaining({ lotCount: 2, portfolioKey: 7, transactionKeys: [1, 2] }),
      tags: expect.objectContaining({ series: 'CA-SERIE-C' }),
    });
  });

  it('does not alert Sentry when at least one lot of the holding valued successfully', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        premiumRows: [{ cohort_start_date: '2020-01-01', financial_asset_key: 100, premium_bps: 25, year_from: 1, year_to: null }],
        rateRows: wideRateRows,
      }),
    });

    const batches = [
      makeBatch({ transaction_date: new Date('2015-01-01'), transaction_key: 1 }), // no applicable cohort
      makeBatch({ transaction_date: new Date('2024-01-01'), transaction_key: 2 }),
    ];

    const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-01'));

    expect(result).toHaveLength(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  describe('certificadoAforroDetail describes the currently-accruing quarter', () => {
    // Séries E/F's real shape: no premium in holding year 1, then a year-2 tier.
    const tieredPremiumRows = [
      { cohort_start_date: null, financial_asset_key: 100, premium_bps: 50, year_from: 2, year_to: 5 },
      { cohort_start_date: null, financial_asset_key: 100, premium_bps: 100, year_from: 6, year_to: 10 },
    ];

    it('reports a real current rate for a brand-new lot with zero completed quarters', async () => {
      Object.assign(DI.em, {
        getKysely: makeDatabaseMock({
          premiumRows: tieredPremiumRows,
          rateRows: [{ base_rate_bps: 200, effective_month: '2024-01-01', financial_asset_key: 100 }],
        }),
      });

      const batches = [makeBatch({ transaction_date: new Date('2024-01-01'), transaction_key: 1 })];

      const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2024-02-01'));

      const detail = result[0]!.certificadoAforroDetail!;
      // Pre-fix this reported 0 (there is no completed quarter to read a rate off) — for the most
      // common holding in the product, since Série F is open for new subscriptions today.
      expect(detail.currentRateBps).toBe(200);
      expect(detail.premiumTierBps).toBe(0);
      expect(detail.lots[0]!.yearsHeld).toBe(1);
      // Built with the same date-fns arithmetic the service uses, so the assertion stays correct
      // in any timezone (a literal UTC instant would drift across a DST boundary).
      expect(detail.nextCapitalizationDate).toBe(addQuarters(new Date('2024-01-01'), 1).toISOString());
    });

    it('moves to the next premium tier on the anniversary, not a quarter later', async () => {
      Object.assign(DI.em, {
        getKysely: makeDatabaseMock({
          premiumRows: tieredPremiumRows,
          rateRows: [
            ...wideRateRows.map((row) => ({ ...row, base_rate_bps: 200 })),
            { base_rate_bps: 200, effective_month: '2025-01-01', financial_asset_key: 100 },
          ],
        }),
      });

      const batches = [makeBatch({ transaction_date: new Date('2024-01-01'), transaction_key: 1 })];

      // Exactly 4 completed quarters: the lot has just entered holding year 2.
      const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-15'));

      const detail = result[0]!.certificadoAforroDetail!;
      expect(detail.lots[0]!.yearsHeld).toBe(2);
      expect(detail.premiumTierBps).toBe(50);
      expect(detail.currentRateBps).toBe(250); // 200 base + the year-2 premium now in force
      expect(detail.nextCapitalizationDate).toBe(addQuarters(new Date('2024-01-01'), 5).toISOString());
    });
  });

  it('converts accrued value using the EUR exchange rate when the portfolio currency is not EUR', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        exchangeRateRow: { rate: '1.1' },
        premiumRows: standardPremiumRows,
        rateRows: wideRateRows,
      }),
    });

    const batches = [makeBatch({ remaining_batch: 1000, transaction_date: new Date('2024-01-01'), transaction_key: 1 })];

    const result = await enrichSavingsCertificateHoldings(batches, 'USD', new Date('2025-01-01'));

    expect(result).toHaveLength(1);
    // 1000 principal converted at 1.1 = 1100, before any interest.
    expect(result[0]!.currentValue).toBeGreaterThan(1100);
  });

  describe('static valuation mode (Séries A/B)', () => {
    const makeStaticBatch = (overrides: Partial<HoldingBatch> = {}): HoldingBatch =>
      makeBatch({
        financial_asset_key: 300,
        financial_asset_name: 'Certificado de Aforro — Série A',
        financial_asset_symbol: 'CA-SERIE-A',
        ...overrides,
      });

    it('values a CA-SERIE-A lot at remaining_batch, with no certificadoAforroDetail and no rate/premium query', async () => {
      // No rate/premium/tax-exempt rows supplied at all — a static-mode lot must never need them.
      // If the service tried to read them for this asset it would find nothing and still work by
      // accident; the real assertion is that computeCertificateLotValue/resolvePremiumBrackets are
      // never reached at all (proven below by there being no accrual detail and an exact value).
      Object.assign(DI.em, { getKysely: makeDatabaseMock({}) });

      const batches = [makeStaticBatch({ remaining_batch: 2500, transaction_date: new Date('2010-01-01'), transaction_key: 1 })];

      const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-01'));

      expect(result).toHaveLength(1);
      const holding = result[0]!;
      expect(holding.financialAssetSymbol).toBe('CA-SERIE-A');
      expect(holding.currentValue).toBe(2500);
      expect(holding.quantity).toBe(2500);
      expect(holding.unrealizedGains).toBe(0);
      expect(holding.unrealizedGainsPercentage).toBe(0);
      expect(holding.certificadoAforroDetail).toBeUndefined();
      expect(holding.relatedTransactionKeys).toEqual([1]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('sums multiple CA-SERIE-A/B lots — a top-up BUY followed by a partial SELL — into one static holding', async () => {
      Object.assign(DI.em, { getKysely: makeDatabaseMock({}) });

      // remaining_batch already reflects FIFO consumption from the SELL, exactly as the accrual
      // path's lots do: an initial BUY of 1000, a top-up BUY of 500 (remaining_batch 1500 after
      // partial consumption), summing to the user's currently-declared balance.
      const batches = [
        makeStaticBatch({ remaining_batch: 1000, transaction_date: new Date('2008-01-01'), transaction_key: 1 }),
        makeStaticBatch({ remaining_batch: 500, transaction_date: new Date('2020-06-01'), transaction_key: 2 }),
      ];

      const result = await enrichSavingsCertificateHoldings(batches, 'EUR', new Date('2025-01-01'));

      expect(result).toHaveLength(1);
      const holding = result[0]!;
      expect(holding.quantity).toBe(1500);
      expect(holding.currentValue).toBe(1500);
      expect(holding.relatedTransactionKeys).toEqual([1, 2]);
      expect(holding.certificadoAforroDetail).toBeUndefined();
    });

    it('converts and rounds a static holding into the portfolio currency', async () => {
      Object.assign(DI.em, { getKysely: makeDatabaseMock({ exchangeRateRow: { rate: '1.1' } }) });

      const batches = [makeStaticBatch({ remaining_batch: 1000, transaction_date: new Date('2010-01-01'), transaction_key: 1 })];

      const result = await enrichSavingsCertificateHoldings(batches, 'USD', new Date('2025-01-01'));

      expect(result).toHaveLength(1);
      expect(result[0]!.currentValue).toBe(1100);
      expect(result[0]!.quantity).toBe(1100);
    });

    it('leaves an accrual-mode series (CA-SERIE-F) in the same run completely unaffected by a static-mode holding', async () => {
      Object.assign(DI.em, {
        getKysely: makeDatabaseMock({
          premiumRows: standardPremiumRows,
          rateRows: wideRateRows,
          taxExemptRows: [{ tax_exempt: false, transaction_key: 2 }],
        }),
      });

      const staticBatch = makeStaticBatch({ remaining_batch: 5000, transaction_date: new Date('2010-01-01'), transaction_key: 1 });
      const accrualBatch = makeBatch({ remaining_batch: 1000, transaction_date: new Date('2024-01-01'), transaction_key: 2 });

      const result = await enrichSavingsCertificateHoldings([staticBatch, accrualBatch], 'EUR', new Date('2025-01-01'));

      expect(result).toHaveLength(2);
      const staticHolding = result.find((h) => h.financialAssetSymbol === 'CA-SERIE-A')!;
      const accrualHolding = result.find((h) => h.financialAssetSymbol === 'CA-SERIE-F')!;

      expect(staticHolding.currentValue).toBe(5000);
      expect(staticHolding.certificadoAforroDetail).toBeUndefined();

      // Accrual-mode holding still goes through the full formula: value exceeds principal (interest
      // accrued) and it still carries its accrual detail, exactly as it does with no static holding
      // present in the same batch set.
      expect(accrualHolding.quantity).toBe(1000);
      expect(accrualHolding.currentValue).toBeGreaterThan(1000);
      expect(accrualHolding.certificadoAforroDetail).toBeDefined();
      expect(accrualHolding.certificadoAforroDetail!.lots).toHaveLength(1);
    });
  });

  it('converts and rounds quantity and every lots[] money field (accruedValue/principal) into the portfolio currency, not just the aggregate currentValue', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        exchangeRateRow: { rate: '1.1' },
        premiumRows: standardPremiumRows,
        // A single rate period so the lot accrues exactly one quarter of interest at a known
        // rate, keeping the expected converted+rounded figures easy to hand-verify.
        rateRows: [{ base_rate_bps: 250, effective_month: '2024-01-01', financial_asset_key: 100 }],
        taxExemptRows: [{ tax_exempt: true, transaction_key: 1 }],
      }),
    });

    const batches = [makeBatch({ remaining_batch: 1000, transaction_date: new Date('2024-01-01'), transaction_key: 1 })];

    const result = await enrichSavingsCertificateHoldings(batches, 'USD', new Date('2024-04-15'));

    expect(result).toHaveLength(1);
    const holding = result[0]!;

    // Principal (1000 EUR) is tax-exempt: one quarter at (250+25)bps/4 = 0.6875% -> accrued
    // 1006.875 EUR gross-equals-net (tax exempt), converted at 1.1 = 1107.5625, rounded to 1107.56.
    const expectedAccruedUsd = 1107.56;
    const expectedPrincipalUsd = 1100; // 1000 * 1.1, already a round number

    // Aggregate holding-level fields (already covered by roundCurrency before this fix).
    expect(holding.currentValue).toBe(expectedAccruedUsd);
    expect(holding.quantity).toBe(expectedPrincipalUsd);

    // Per-lot fields — this is the gap the review caught: these must be converted+rounded too,
    // not left as raw un-rounded EUR figures.
    expect(holding.certificadoAforroDetail!.lots).toHaveLength(1);
    const lot = holding.certificadoAforroDetail!.lots[0]!;
    expect(lot.principal).toBe(expectedPrincipalUsd);
    expect(lot.accruedValue).toBe(expectedAccruedUsd);
    // Both values must be exactly cent-rounded (no floating-point compounding artifacts leaking
    // into the response), i.e. equal their own roundCurrency application.
    expect(lot.accruedValue).toBe(Math.round(lot.accruedValue * 100) / 100);
    expect(lot.principal).toBe(Math.round(lot.principal * 100) / 100);
  });
});
