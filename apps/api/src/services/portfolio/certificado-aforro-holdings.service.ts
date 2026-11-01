import * as Sentry from '@sentry/node';
import { addQuarters } from 'date-fns';

import { DI } from '@app/app';
import { anyOf, sqlQuery, toDate } from '@app/database/sql';
import logger from '@utils/logger';

import {
  CERTIFICADO_AFORRO_SERIES_CONSTANTS,
  computeCertificateLotValue,
  type PremiumBracket,
  type PremiumScheduleRow,
  type RatePeriod,
  resolvePremiumBrackets,
} from './certificado-aforro-calculation.service';
import { roundCurrency } from './portfolio-currency.utils';
import type { CertificadoAforroLotDetail, HoldingBatch, PortfolioHolding } from './portfolio-holdings.utils';

export const SAVINGS_CERTIFICATE_TYPE_NAME = 'Savings Certificate';

interface RateAndPremiumData {
  premiumSchedulesByAsset: Map<number, PremiumScheduleRow[]>;
  ratePeriodsByAsset: Map<number, RatePeriod[]>;
  taxExemptByTransactionKey: Map<number, boolean>;
}

export function isSavingsCertificateBatch(batch: HoldingBatch): boolean {
  return batch.financial_asset_type_name === SAVINGS_CERTIFICATE_TYPE_NAME;
}

async function loadRateAndPremiumData(assetKeys: number[], transactionKeys: number[]): Promise<RateAndPremiumData> {
  const db = sqlQuery(DI.em);

  const [rateRows, premiumRows, taxExemptRows] = await Promise.all([
    db.selectFrom('certificado_aforro_rate_period').selectAll().where(anyOf('financial_asset_key', assetKeys)).where('deleted_at', 'is', null).execute() as Promise<
      { base_rate_bps: number; effective_month: Date | string; financial_asset_key: number }[]
    >,
    db.selectFrom('certificado_aforro_premium_schedule').selectAll().where(anyOf('financial_asset_key', assetKeys)).where('deleted_at', 'is', null).execute() as Promise<
      { cohort_start_date: Date | null | string; financial_asset_key: number; premium_bps: number; year_from: number; year_to: null | number }[]
    >,
    db.selectFrom('certificado_aforro_subscription_detail').selectAll().where(anyOf('transaction_key', transactionKeys)).execute() as Promise<
      { tax_exempt: boolean; transaction_key: number }[]
    >,
  ]);

  const ratePeriodsByAsset = new Map<number, RatePeriod[]>();
  for (const row of rateRows) {
    const list = ratePeriodsByAsset.get(row.financial_asset_key) ?? [];
    list.push({ baseRateBps: row.base_rate_bps, effectiveMonth: toDate(row.effective_month) });
    ratePeriodsByAsset.set(row.financial_asset_key, list);
  }

  const premiumSchedulesByAsset = new Map<number, PremiumScheduleRow[]>();
  for (const row of premiumRows) {
    const list = premiumSchedulesByAsset.get(row.financial_asset_key) ?? [];
    list.push({
      cohortStartDate: row.cohort_start_date ? toDate(row.cohort_start_date) : null,
      premiumBps: row.premium_bps,
      yearFrom: row.year_from,
      yearTo: row.year_to,
    });
    premiumSchedulesByAsset.set(row.financial_asset_key, list);
  }

  const taxExemptByTransactionKey = new Map(taxExemptRows.map((r) => [r.transaction_key, r.tax_exempt]));

  return { premiumSchedulesByAsset, ratePeriodsByAsset, taxExemptByTransactionKey };
}

/** Mirrors `findPremiumBps` in `certificado-aforro-calculation.service.ts` (not exported there —
 * `computeCertificateLotValue` returns the combined base+premium `rateBps`, not the premium
 * component alone, so the accrual panel's `premiumTierBps` field recomputes it here). */
function findPremiumBpsForYear(brackets: PremiumBracket[], yearsHeld: number): number {
  const bracket = brackets.find((candidate) => yearsHeld >= candidate.yearFrom && (candidate.yearTo == null || yearsHeld <= candidate.yearTo));
  return bracket?.premiumBps ?? 0;
}

/**
 * Values Savings Certificate lots via per-lot accrual (not market price), one PortfolioHolding
 * per (portfolio, asset) pair, summing all open lots of that asset. Must run on batches BEFORE
 * aggregateBatchesIntoAssets collapses their per-lot transaction_date.
 *
 * Per-lot valuation is wrapped in try/catch: `computeCertificateLotValue` and
 * `resolvePremiumBrackets` throw on invalid/missing data (no applicable premium cohort, no rate
 * period at all for a needed month). A single bad or not-yet-seeded lot must not 500 the whole
 * portfolio holdings response — it's skipped (with a warn log) and the rest of the portfolio
 * (including this asset's other lots) still values normally.
 */
export async function enrichSavingsCertificateHoldings(
  batches: HoldingBatch[],
  currency: string,
  asOfDate: Date = new Date(),
): Promise<PortfolioHolding[]> {
  const openBatches = batches.filter((b) => b.remaining_batch != null && b.remaining_batch > 0);
  if (openBatches.length === 0) return [];

  const assetKeys = [...new Set(openBatches.map((b) => b.financial_asset_key))];
  const transactionKeys = openBatches.map((b) => b.transaction_key);

  // Static-mode series (Séries A/B) never read rate/premium data — skip fetching it for
  // asset keys that resolve to a known static series. Unknown symbols are left in (queried anyway)
  // rather than guessed at, matching the existing "skip with a warn" handling for those below.
  const rateAndPremiumAssetKeys = assetKeys.filter((assetKey) => {
    const symbol = openBatches.find((b) => b.financial_asset_key === assetKey)?.financial_asset_symbol;
    const constants = symbol ? CERTIFICADO_AFORRO_SERIES_CONSTANTS[symbol] : undefined;
    return constants?.valuationMode !== 'static';
  });
  const { premiumSchedulesByAsset, ratePeriodsByAsset, taxExemptByTransactionKey } = await loadRateAndPremiumData(
    rateAndPremiumAssetKeys,
    transactionKeys,
  );

  const eurExchangeRow =
    currency === 'EUR'
      ? null
      : await sqlQuery(DI.em)
          .selectFrom('exchange_rate as er')
          .innerJoin('currency as from_c', 'er.from_currency_key', 'from_c.currency_key')
          .innerJoin('currency as to_c', 'er.to_currency_key', 'to_c.currency_key')
          .select('er.rate')
          .where('from_c.code', '=', 'EUR')
          .where('to_c.code', '=', currency)
          .orderBy('er.date', 'desc')
          .limit(1)
          .executeTakeFirst();
  const conversionRate = eurExchangeRow ? Number(eurExchangeRow.rate) : 1;

  const lotsByHolding = new Map<string, HoldingBatch[]>();
  for (const batch of openBatches) {
    const key = `${batch.portfolio_key}:${batch.financial_asset_key}`;
    const list = lotsByHolding.get(key) ?? [];
    list.push(batch);
    lotsByHolding.set(key, list);
  }

  const holdings: PortfolioHolding[] = [];
  for (const lots of lotsByHolding.values()) {
    const first = lots[0]!;
    const seriesConstants = CERTIFICADO_AFORRO_SERIES_CONSTANTS[first.financial_asset_symbol];
    if (!seriesConstants) {
      logger.warn({ symbol: first.financial_asset_symbol }, 'No series constants for Savings Certificate symbol, skipping accrual valuation');
      continue;
    }

    // Static-mode series (Séries A/B): perpetual, no formula — value is whatever the user
    // last declared via BUY/SELL, i.e. `remaining_batch` summed directly. No rate/premium lookup,
    // no computeCertificateLotValue, no certificadoAforroDetail (there is no accrual detail to
    // report). currentValue === principal by definition, so gains are always zero.
    if (seriesConstants.valuationMode === 'static') {
      let totalStaticPrincipal = 0;
      const staticTransactionKeys: number[] = [];
      for (const lot of lots) {
        const principal = lot.remaining_batch ?? 0;
        if (principal <= 0) continue;
        totalStaticPrincipal += principal;
        staticTransactionKeys.push(lot.transaction_key);
      }

      const staticValue = roundCurrency(totalStaticPrincipal * conversionRate);
      holdings.push({
        allocation: null,
        averageBuyPrice: 1,
        currency,
        currentPrice: null,
        currentValue: staticValue,
        financialAssetCurrencyCode: first.financial_asset_currency_code,
        financialAssetKey: first.financial_asset_key,
        financialAssetLogoUrl: first.financial_asset_logo_url,
        financialAssetName: first.financial_asset_name,
        financialAssetSymbol: first.financial_asset_symbol,
        financialAssetType: first.financial_asset_type_name,
        portfolioKey: first.portfolio_key,
        quantity: staticValue,
        relatedTransactionKeys: staticTransactionKeys,
        unrealizedGains: 0,
        unrealizedGainsPercentage: 0,
        // certificadoAforroDetail intentionally omitted — no accrual detail applies to a static series.
      });
      continue;
    }

    const ratePeriods = ratePeriodsByAsset.get(first.financial_asset_key) ?? [];
    const schedules = premiumSchedulesByAsset.get(first.financial_asset_key) ?? [];

    let totalPrincipal = 0;
    let totalAccrued = 0;
    const lotDetails: CertificadoAforroLotDetail[] = [];
    let currentRateBps = 0;
    let premiumTierBps = 0;
    let nextCapitalizationDate: Date | null = null;

    for (const lot of lots) {
      const principal = lot.remaining_batch ?? 0;
      if (principal <= 0) continue;

      try {
        const taxExempt = taxExemptByTransactionKey.get(lot.transaction_key) ?? false;
        const premiumBrackets = resolvePremiumBrackets(schedules, lot.transaction_date);
        const maturityDate = new Date(lot.transaction_date);
        maturityDate.setFullYear(maturityDate.getFullYear() + seriesConstants.termYears);

        const { accruedValue, currentQuarter, quarters } = computeCertificateLotValue({
          asOfDate,
          logContext: { symbol: lot.financial_asset_symbol },
          maturityDate,
          premiumBrackets,
          principal,
          rateCapBps: seriesConstants.capBps,
          rateFloorBps: seriesConstants.floorBps,
          ratePeriods,
          subscriptionDate: lot.transaction_date,
          taxExempt,
        });
        totalPrincipal += principal;
        totalAccrued += accruedValue;

        const lastQuarter = quarters.at(-1);
        // Years held describes the quarter the lot is accruing in RIGHT NOW, not the last one that
        // capitalised. Deriving it from completed quarters alone (`(length - 1) / 4`) lags reality
        // by a quarter at every year boundary — a lot that has just completed its 4th quarter is in
        // holding year 2 and already earning year-2's premium, not still in year 1. `currentQuarter`
        // is null only for a matured lot (or an unprovisioned series), where the last completed
        // quarter genuinely is the most recent truth.
        const yearsHeld = currentQuarter?.yearsHeld ?? (quarters.length > 0 ? Math.floor((quarters.length - 1) / 4) + 1 : 1);
        // Convert to the portfolio's currency and round the same way the aggregate
        // currentValue/initialInvestment below are — these raw EUR values otherwise leak
        // un-rounded floating-point compounding artifacts, and (for non-EUR portfolios) a
        // silent EUR/portfolio-currency mismatch, into the API response.
        lotDetails.push({
          accruedValue: roundCurrency(accruedValue * conversionRate),
          principal: roundCurrency(principal * conversionRate),
          subscriptionDate: lot.transaction_date.toISOString(),
          taxExempt,
          transactionKey: lot.transaction_key,
          yearsHeld,
        });

        // Representative rate/premium/next-capitalization shown for the holding: taken from the
        // first successfully-valued lot (deterministic, matches the seriesConstants/asset metadata
        // already sourced from `first` above). Lots subscribed at different dates can legally sit
        // on different premium tiers; the accrual panel surfaces per-lot detail via `lots[]` for that.
        if (nextCapitalizationDate === null) {
          // All three describe the CURRENTLY-ACCRUING quarter. Reading them off `quarters.at(-1)`
          // instead reports the last *completed* quarter — which is zero/absent for a brand-new lot
          // (the most common case, since Série F is open for new subscriptions), and one tier stale
          // at every anniversary. Fall back to the last completed quarter only when there is no
          // current one (matured lot / no rate data), never in the ordinary case.
          currentRateBps = currentQuarter?.rateBps ?? lastQuarter?.rateBps ?? 0;
          premiumTierBps = currentQuarter?.premiumBps ?? findPremiumBpsForYear(premiumBrackets, yearsHeld);
          nextCapitalizationDate =
            currentQuarter?.quarterEnd ?? addQuarters(lastQuarter ? lastQuarter.quarterEnd : lot.transaction_date, 1);
        }
      } catch (error) {
        logger.warn(
          { error, symbol: lot.financial_asset_symbol, transactionKey: lot.transaction_key },
          'Failed to value Savings Certificate lot, skipping it from holdings valuation',
        );
      }
    }

    // Every lot for this asset failed to value (e.g. no seeded rate/premium data yet). The holding
    // is skipped rather than surfaced as a bogus zero-value line — but silently dropping money a
    // user told us they own is not an acceptable steady state, so alert. A single failed lot among
    // several is already covered by the per-lot warn above; this is the total-loss case only.
    //
    // The symbol is in both the message and the `series` tag on purpose. Séries C and D are a
    // KNOWN, deliberate provisioning gap (their premium schedules await exact IGCP figures), so
    // `CA-SERIE-C`/`CA-SERIE-D` events here are expected background noise a triager can filter out
    // by tag; `CA-SERIE-E`/`CA-SERIE-F` events are NOT — those series are provisioned, so a failure
    // there is a real bug or a data regression. Same code path, visibly different severity, no
    // branch that could drift out of sync with which series are actually seeded.
    if (lotDetails.length === 0) {
      const symbol = first.financial_asset_symbol;
      Sentry.captureMessage(`Savings Certificate holding failed to value — provisioning gap (${symbol})`, {
        extra: {
          assetName: first.financial_asset_name,
          financialAssetKey: first.financial_asset_key,
          lotCount: lots.length,
          portfolioKey: first.portfolio_key,
          premiumScheduleRowCount: schedules.length,
          ratePeriodCount: ratePeriods.length,
          transactionKeys: lots.map((lot) => lot.transaction_key),
        },
        level: 'warning',
        tags: { feature: 'certificado-aforro', series: symbol },
      });
      logger.warn(
        { lotCount: lots.length, portfolioKey: first.portfolio_key, symbol },
        'Every Savings Certificate lot failed to value — dropping the holding from the portfolio',
      );
      continue;
    }

    const currentValue = roundCurrency(totalAccrued * conversionRate);
    const initialInvestment = roundCurrency(totalPrincipal * conversionRate);
    const unrealizedGains = roundCurrency(currentValue - initialInvestment);

    holdings.push({
      allocation: null, // recomputed by recomputeAllocation across the combined holding set
      averageBuyPrice: 1,
      certificadoAforroDetail: {
        currentRateBps,
        lots: lotDetails,
        nextCapitalizationDate: (nextCapitalizationDate ?? asOfDate).toISOString(),
        premiumTierBps,
      },
      currency,
      currentPrice: null,
      currentValue,
      financialAssetCurrencyCode: first.financial_asset_currency_code,
      financialAssetKey: first.financial_asset_key,
      financialAssetLogoUrl: first.financial_asset_logo_url,
      financialAssetName: first.financial_asset_name,
      financialAssetSymbol: first.financial_asset_symbol,
      financialAssetType: first.financial_asset_type_name,
      portfolioKey: first.portfolio_key,
      quantity: roundCurrency(totalPrincipal * conversionRate),
      relatedTransactionKeys: lotDetails.map((l) => l.transactionKey),
      unrealizedGains,
      unrealizedGainsPercentage: initialInvestment !== 0 ? (unrealizedGains / initialInvestment) * 100 : null,
    });
  }

  return holdings;
}
