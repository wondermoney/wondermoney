/* eslint-disable perfectionist/sort-classes */
import { randomUUID } from 'node:crypto';

import { type EntityManager, QueryOrder, TransactionPropagation, UniqueConstraintViolationException } from '@mikro-orm/core';
import { normalizePortfolioTransactionQuantity } from '@wondermoney/shared';
import { pick } from 'lodash-es';

import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { CertificadoAforroSubscriptionDetail } from '@entity/CertificadoAforroSubscriptionDetail';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import type { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetStockAdjustment } from '@entity/FinancialAssetStockAdjustment';
import { FinancialBroker } from '@entity/FinancialBroker';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import type { Enqueue } from '@service/queue/enqueue';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import assetPriceService from './asset-price.service.js';
import { CERTIFICADO_AFORRO_SERIES_CONSTANTS } from './certificado-aforro-calculation.service.js';
import { SAVINGS_CERTIFICATE_TYPE_NAME } from './certificado-aforro-holdings.service.js';
import { resolveOrCreateFinancialAsset } from './financial-asset.service.js';
import historicalAssetPriceBackfillClient, { type HistoricalAssetPriceBackfillItem, toYmd } from './historical-asset-price-backfill-client.js';
import { type HoldingTransactionTimelineItem, replayHoldingTimeline, type StockSplitTimelineItem } from './portfolio-holdings.utils.js';
import portfolioSnapshotService from './portfolio-snapshot.service.js';
import { syncStockSplitsForAsset } from './stock-split-sync.service.js';

interface CreateTransactionParams {
  assetSymbol: string;
  brokerId?: number;
  externalTransactionId?: string;
  feeAmount?: number;
  feeCurrencyId?: number;
  financialAsset?: FinancialAsset;
  financialTransactionTypeId: number;
  internalTransactionId?: string;
  notes?: string;
  originalCurrencyId?: number;
  originalUnitPrice?: number;
  portfolioId: number;
  quantity: number;
  settlementCurrencyId: number;
  skipMaintenance?: boolean;
  taxExempt?: boolean;
  tenantId?: number;
  transactionDate: Date;
  unitPrice: number;
}

interface QuantityValidationTransaction {
  financialTransactionTypeKey?: Pick<FinancialTransactionType, 'financialTransactionTypeKey'>;
  quantity: number;
  transactionDate?: Date;
  transactionKey?: number;
}

interface SyntheticSplitRow {
  denominator?: number;
  editable: false;
  financialAssetKey: { esgScore?: number; financialAssetKey: number; logoUrl?: string; name?: string; symbol?: string };
  id: string;
  itemType: 'STOCK_SPLIT';
  numerator?: number;
  portfolioKey: { name?: string; portfolioKey: number };
  splitRatio?: number;
  transactionDate: Date;
}

interface UpdateTransactionParams {
  brokerId?: null | number;
  feeAmount?: null | number;
  feeCurrencyId?: null | number;
  financialTransactionTypeId?: number;
  notes?: null | string;
  originalCurrencyId?: null | number;
  originalUnitPrice?: null | number;
  quantity?: number;
  settlementCurrencyId?: number;
  transactionDate?: Date;
  unitPrice?: number;
}

/**
 * Manual entries have no broker-supplied external id, so they cannot reuse
 * @wondermoney/shared's generateInternalFinancialTransactionId (a content-derived
 * key meant for import re-run de-duplication) without one — omitting the argument
 * silently interpolated the literal string "undefined", and the resulting key
 * carried no tenant/portfolio component against a DB-global unique constraint, so
 * two different tenants entering the same symbol/amount/timestamp collided with a
 * raw 500 (RAD-603). A random id sidesteps both: manual entries have no import to
 * re-run, so there is nothing for a content-derived key to protect here.
 */
function generateManualPortfolioTransactionId(): string {
  return `manual:${randomUUID()}`;
}

const SELL_QUANTITY_EXCEEDS_HOLDINGS_MESSAGE = 'Sell quantity exceeds available holdings for this portfolio';

/**
 * Turns a missing enqueue seam into a loud, up-front failure. Callers that enable
 * maintenance must supply the transport before anything is persisted; discovering the
 * missing dependency after commit would strand a saved transaction behind a retry that
 * then hits the unique constraint instead of the real problem (RAD-603 pattern).
 */
function requireMaintenanceEnqueue(enqueue: Enqueue | undefined): Enqueue {
  if (!enqueue) {
    throw new Error('Enqueue capability is required for portfolio transaction maintenance');
  }
  return enqueue;
}

function sameCalendarDate(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

/**
 * Service for managing portfolio transactions
 */
class PortfolioTransactionService {
  private async lockPortfolioAssetTransactionTimeline(
    entityManager: EntityManager,
    portfolioId: number,
    financialAsset: FinancialAsset,
  ): Promise<void> {
    await entityManager.getConnection().execute(
      'SELECT pg_advisory_xact_lock(?, ?)',
      [portfolioId, financialAsset.financialAssetKey],
      'run',
      entityManager.getTransactionContext(),
    );
  }

  private async refreshSnapshotsFromDate(portfolioId: number, affectedDate?: Date): Promise<void> {
    await portfolioSnapshotService.backfillSnapshotsForPortfolio(portfolioId, affectedDate);
  }

  private async loadSyntheticSplitRows(params: {
    appuser: Appuser;
    fromDate?: Date;
    portfolioId?: number;
    ticker?: string;
    toDate?: Date;
  }): Promise<
    SyntheticSplitRow[]
  > {
    const { fromDate, portfolioId, ticker, toDate } = params;
    const txFilter: Record<string, unknown> = {
      deletedAt: undefined,
      financialTransactionTypeKey: { financialTransactionTypeKey: { $in: [FINANCIAL_TRANSACTION_TYPES.BUY, FINANCIAL_TRANSACTION_TYPES.SELL] } },
    };
    if (portfolioId) txFilter['portfolioKey'] = { portfolioKey: portfolioId };
    if (ticker) txFilter['financialAssetKey'] = { symbol: ticker };

    const ownershipHistory = await DI.em.find(FinancialTransaction, txFilter, {
      orderBy: { transactionDate: QueryOrder.ASC },
      populate: ['financialAssetKey', 'financialTransactionTypeKey', 'portfolioKey'],
    });

    const relevantAssetKeys = [...new Set(ownershipHistory.map((transaction) => transaction.financialAssetKey?.financialAssetKey).filter((key): key is number => key != null))];
    if (!relevantAssetKeys.length) return [];

    const splitFilter: Record<string, unknown> = { adjustmentType: 'SPLIT', deletedAt: undefined, financialAssetKey: { financialAssetKey: { $in: relevantAssetKeys } } };
    if (ticker) splitFilter['financialAssetKey'] = { financialAssetKey: { $in: relevantAssetKeys }, symbol: ticker };
    if (fromDate && toDate) splitFilter['date'] = { $gte: fromDate, $lte: toDate };
    else if (fromDate) splitFilter['date'] = { $gte: fromDate };
    else if (toDate) splitFilter['date'] = { $lte: toDate };

    const displaySplits = await DI.em.find(FinancialAssetStockAdjustment, splitFilter, { populate: ['financialAssetKey'] });
    if (!displaySplits.length) return [];

    const latestDisplaySplitDate = displaySplits.reduce(
      (max, split) => (split.date > max ? split.date : max),
      displaySplits[0]?.date ?? new Date(0),
    );

    const replayOwnershipHistory = ownershipHistory.filter((transaction) => transaction.transactionDate && transaction.transactionDate <= latestDisplaySplitDate);
    const relevantPortfolioKeys = portfolioId
      ? [portfolioId]
      : [...new Set(replayOwnershipHistory.map((transaction) => transaction.portfolioKey?.portfolioKey).filter((key): key is number => key != null))];
    const replaySplitFilter: Record<string, unknown> = {
      adjustmentType: 'SPLIT',
      date: { $lte: latestDisplaySplitDate },
      deletedAt: undefined,
      financialAssetKey: { financialAssetKey: { $in: [...new Set(displaySplits.map((split) => split.financialAssetKey.financialAssetKey))] } },
    };
    const replaySplits = await DI.em.find(FinancialAssetStockAdjustment, replaySplitFilter, { populate: ['financialAssetKey'] });
    const rows: SyntheticSplitRow[] = [];

    const historyByPortfolioAsset = new Map<string, FinancialTransaction[]>();
    for (const transaction of replayOwnershipHistory) {
      const portfolio = transaction.portfolioKey?.portfolioKey;
      const asset = transaction.financialAssetKey?.financialAssetKey;
      if (portfolio == null || asset == null || !transaction.transactionDate) continue;
      const key = `${portfolio}:${asset}`;
      const current = historyByPortfolioAsset.get(key) ?? [];
      current.push(transaction);
      historyByPortfolioAsset.set(key, current);
    }
    for (const history of historyByPortfolioAsset.values()) {
      history.sort((a, b) => (a.transactionDate?.getTime() ?? 0) - (b.transactionDate?.getTime() ?? 0));
    }

    const replaySplitsByAsset = new Map<number, FinancialAssetStockAdjustment[]>();
    for (const split of replaySplits) {
      const assetKey = split.financialAssetKey.financialAssetKey;
      const current = replaySplitsByAsset.get(assetKey) ?? [];
      current.push(split);
      replaySplitsByAsset.set(assetKey, current);
    }
    for (const splits of replaySplitsByAsset.values()) {
      splits.sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    for (const split of displaySplits) {
      const assetKey = split.financialAssetKey.financialAssetKey;
      for (const currentPortfolioKey of relevantPortfolioKeys) {
        const baseHistory = historyByPortfolioAsset.get(`${currentPortfolioKey}:${assetKey}`) ?? [];
        const history = this.getHistoryBeforeSplit(baseHistory, split.date);
        const priorSplits = this.getPriorSplitTimelineItems(replaySplitsByAsset.get(assetKey) ?? [], split.date, assetKey);
        const timeline = [
          ...history.map((transaction) => this.toHoldingTimelineTransaction(transaction, currentPortfolioKey, split.financialAssetKey)),
          ...priorSplits,
        ];
        const replayResult = replayHoldingTimeline(timeline);
        if (!replayResult.openBatches.some((batch) => batch.portfolio_key === currentPortfolioKey && batch.financial_asset_key === assetKey)) continue;
        const portfolioName = history[0]?.portfolioKey?.name ?? baseHistory[0]?.portfolioKey?.name;
        rows.push({
          denominator: split.denominator,
          editable: false,
          financialAssetKey: {
            esgScore: split.financialAssetKey.esgScore,
            financialAssetKey: assetKey,
            logoUrl: split.financialAssetKey.logoUrl,
            name: split.financialAssetKey.name,
            symbol: split.financialAssetKey.symbol,
          },
          id: `stock-split:${split.financialAssetStockAdjustmentKey}:${currentPortfolioKey}:${assetKey}`,
          itemType: 'STOCK_SPLIT',
          numerator: split.numerator,
          portfolioKey: { name: portfolioName, portfolioKey: currentPortfolioKey },
          splitRatio: split.splitRatio,
          transactionDate: split.date,
        });
      }
    }

    return rows;
  }

  private getHistoryBeforeSplit(history: FinancialTransaction[], splitDate: Date): FinancialTransaction[] {
    const rows: FinancialTransaction[] = [];
    for (const transaction of history) {
      if (!transaction.transactionDate) continue;
      if (transaction.transactionDate >= splitDate || sameCalendarDate(transaction.transactionDate, splitDate)) break;
      rows.push(transaction);
    }
    return rows;
  }

  private getPriorSplitTimelineItems(
    splits: FinancialAssetStockAdjustment[],
    splitDate: Date,
    assetKey: number,
  ): StockSplitTimelineItem[] {
    const rows: StockSplitTimelineItem[] = [];
    for (const candidate of splits) {
      if (candidate.date >= splitDate || sameCalendarDate(candidate.date, splitDate)) break;
      rows.push(this.toStockSplitTimelineItem(candidate, assetKey));
    }
    return rows;
  }

  private toHoldingTimelineTransaction(
    transaction: QuantityValidationTransaction,
    portfolioId: number,
    financialAsset: FinancialAsset,
  ): HoldingTransactionTimelineItem {
    return {
      financial_asset_currency_code: undefined,
      financial_asset_esg_score: undefined,
      financial_asset_key: financialAsset.financialAssetKey,
      financial_asset_logo_url: financialAsset.logoUrl,
      financial_asset_name: financialAsset.name ?? 'UNKNOWN',
      financial_asset_symbol: financialAsset.symbol,
      financial_asset_type_name: financialAsset.financialAssetTypeKey?.name ?? 'UNKNOWN',
      financial_transaction_type_key: transaction.financialTransactionTypeKey?.financialTransactionTypeKey ?? 0,
      itemType: 'TRANSACTION',
      portfolio_key: portfolioId,
      quantity: transaction.quantity,
      transaction_date: transaction.transactionDate ?? new Date(0),
      transaction_key: transaction.transactionKey ?? Number.MAX_SAFE_INTEGER,
      unit_appuser_amount: 0,
      unit_settlement_amount: 0,
    };
  }

  private sortTransactionTimeline<T extends { transactionDate?: Date }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const dateDiff = (b.transactionDate?.getTime() ?? 0) - (a.transactionDate?.getTime() ?? 0);
      if (dateDiff !== 0) return dateDiff;
      const aType = 'itemType' in a ? (a as { itemType?: string }).itemType : 'TRANSACTION';
      const bType = 'itemType' in b ? (b as { itemType?: string }).itemType : 'TRANSACTION';
      if (aType !== bType) return aType === 'STOCK_SPLIT' ? -1 : 1;
      const aKey = 'transactionKey' in a ? (a as { transactionKey?: number }).transactionKey ?? 0 : 0;
      const bKey = 'transactionKey' in b ? (b as { transactionKey?: number }).transactionKey ?? 0 : 0;
      if (aKey !== bKey) return bKey - aKey;
      const aId = 'id' in a ? (a as { id?: string }).id ?? '' : '';
      const bId = 'id' in b ? (b as { id?: string }).id ?? '' : '';
      return aId.localeCompare(bId);
    });
  }

  private toTransactionListRow(transaction: FinancialTransaction) {
    return pick(transaction, [
      'transactionKey',
      'transactionDate',
      'quantity',
      'financialTransactionTypeKey.financialTransactionTypeKey',
      'financialTransactionTypeKey.name',
      'financialBrokerKey.financialBrokerKey',
      'financialBrokerKey.name',
      'originalUnitAmount',
      'originalAmount',
      'originalCurrencyKey.currencyKey',
      'originalCurrencyKey.code',
      'settlementUnitAmount',
      'settlementAmount',
      'settlementCurrencyKey.currencyKey',
      'settlementCurrencyKey.code',
      'settlementExchangeRate',
      'appuserUnitAmount',
      'appuserSettlementAmount',
      'appuserCurrencyExchangeRate',
      'notes',
      'financialAssetKey.name',
      'financialAssetKey.symbol',
      'financialAssetKey.financialAssetKey',
      'financialAssetKey.logoUrl',
      'financialAssetKey.esgScore',
      'financialAssetExchangeKey.',
      'portfolioKey.portfolioKey',
      'portfolioKey.name',
      'feeAmount',
      'feeCurrencyKey.currencyKey',
      'feeCurrencyKey.code',
    ]);
  }

  private toStockSplitTimelineItem(
    split: Pick<FinancialAssetStockAdjustment, 'date' | 'denominator' | 'financialAssetKey' | 'numerator' | 'splitRatio'>,
    financialAssetKey: number,
  ): StockSplitTimelineItem {
    return {
      date: split.date,
      denominator: split.denominator ?? Number.NaN,
      financial_asset_key: financialAssetKey,
      itemType: 'SPLIT',
      numerator: split.numerator ?? Number.NaN,
      split_ratio: split.splitRatio,
    };
  }

  private async triggerHistoricalAssetPriceBackfill(
    portfolioId: number,
    item: HistoricalAssetPriceBackfillItem,
    enqueue: Enqueue,
  ): Promise<void> {
    await historicalAssetPriceBackfillClient.trigger({ items: [item], portfolioId }, { enqueue });
  }

  private async validateTransactionTimelineDoesNotOversell(
    entityManager: EntityManager,
    appuser: Appuser,
    portfolioId: number,
    financialAsset: FinancialAsset,
    proposedTransaction?: QuantityValidationTransaction,
    excludedTransactionKey?: number,
  ): Promise<void> {
    const existingTransactions = await entityManager.find(
      FinancialTransaction,
      {
        appuserKey: appuser,
        deletedAt: undefined,
        financialAssetKey: financialAsset,
        portfolioKey: { portfolioKey: portfolioId },
      },
      { populate: ['financialTransactionTypeKey'] },
    );

    const stockSplits = await entityManager.find(FinancialAssetStockAdjustment, {
      adjustmentType: 'SPLIT',
      deletedAt: undefined,
      financialAssetKey: financialAsset,
    });

    const timeline = existingTransactions
      .filter((transaction) => transaction.transactionKey !== excludedTransactionKey)
      .map((transaction) =>
        transaction.transactionKey === proposedTransaction?.transactionKey ? proposedTransaction : transaction,
      );

    if (proposedTransaction && !timeline.some((transaction) => transaction.transactionKey === proposedTransaction.transactionKey)) {
      timeline.push(proposedTransaction);
    }

    const replayResult = replayHoldingTimeline([
      ...timeline.map((transaction) => this.toHoldingTimelineTransaction(transaction, portfolioId, financialAsset)),
      ...stockSplits.map((split) => this.toStockSplitTimelineItem(split, financialAsset.financialAssetKey)),
    ]);

    if (replayResult.oversoldByPortfolioAsset.has(`${portfolioId}:${financialAsset.financialAssetKey}`)) {
      throw new BadRequestError(SELL_QUANTITY_EXCEEDS_HOLDINGS_MESSAGE);
    }
  }

  /**
   * Get transactions for a specific portfolio
   */
  async getPortfolioTransactions(appuser: Appuser, portfolioId: number, fromDate?: Date, toDate?: Date, limit?: number) {
    const transactions = await DI.em.find(
      FinancialTransaction,
      {
        deletedAt: undefined,
        portfolioKey: { portfolioKey: portfolioId },
        ...(fromDate && !toDate && { transactionDate: { $gte: fromDate } }),
        ...(toDate && !fromDate && { transactionDate: { $lte: toDate } }),
        ...(fromDate && toDate && { transactionDate: { $gte: fromDate, $lte: toDate } }),
      },
      {
        orderBy: { transactionDate: QueryOrder.DESC },
        ...(limit ? { limit } : {}),
        populate: [
          'settlementCurrencyKey',
          'originalCurrencyKey',
          'portfolioKey',
          'financialAssetKey',
          'financialBrokerKey',
          'financialTransactionTypeKey',
          'feeCurrencyKey',
        ],
      },
    );

    const splitRows = await this.loadSyntheticSplitRows({ appuser, fromDate, portfolioId, toDate });
    const timeline = this.sortTransactionTimeline([...transactions.map((transaction) => this.toTransactionListRow(transaction)), ...splitRows]);
    return limit ? timeline.slice(0, limit) : timeline;
  }

  /**
   * Get transactions across all portfolios for a user
   */
  async getPortfoliosTransactions(appuser: Appuser, fromDate?: Date, toDate?: Date, ticker?: string, limit?: number) {
    const transactions = await DI.em.find(
      FinancialTransaction,
      {
        deletedAt: undefined,
        ...(ticker && { financialAssetKey: { symbol: ticker } }),
        ...(fromDate && !toDate && { transactionDate: { $gte: fromDate } }),
        ...(toDate && !fromDate && { transactionDate: { $lte: toDate } }),
        ...(fromDate && toDate && { transactionDate: { $gte: fromDate, $lte: toDate } }),
      },
      {
        orderBy: { transactionDate: QueryOrder.DESC },
        ...(limit ? { limit } : {}),
        populate: [
          'settlementCurrencyKey',
          'originalCurrencyKey',
          'portfolioKey',
          'financialAssetKey',
          'financialBrokerKey',
          'financialTransactionTypeKey',
          'feeCurrencyKey',
        ],
      },
    );

    const splitRows = await this.loadSyntheticSplitRows({ appuser, fromDate, ticker, toDate });
    const timeline = this.sortTransactionTimeline([...transactions.map((transaction) => this.toTransactionListRow(transaction)), ...splitRows]);
    return limit ? timeline.slice(0, limit) : timeline;
  }

  /**
   * Create a new portfolio transaction
   */
  async createPortfolioTransaction(
    appuser: Appuser,
    params: CreateTransactionParams,
    entityManager?: EntityManager,
    deps?: { enqueue: Enqueue },
  ): Promise<void> {
    // Maintenance transport is resolved before anything is persisted: when maintenance is
    // enabled the deps are mandatory, and `skipMaintenance` paths (import finalize) are
    // exempt without inventing a transport. The discriminated result keeps `enqueue`
    // non-optional inside the maintenance branch below with no post-commit detection.
    const maintenance = params.skipMaintenance === true
      ? { skip: true as const }
      : { enqueue: requireMaintenanceEnqueue(deps?.enqueue), skip: false as const };
    const em = entityManager ?? DI.em;
    const {
      assetSymbol,
      brokerId,
      feeAmount,
      feeCurrencyId,
      financialAsset: providedFinancialAsset,
      financialTransactionTypeId,
      notes,
      originalCurrencyId,
      originalUnitPrice,
      portfolioId,
      quantity,
      settlementCurrencyId,
      tenantId,
      transactionDate,
      unitPrice,
    } = params;

    // Validate and fetch app user tenant
    const appUserTenantCriteria: Record<string, unknown> = { appuserKey: appuser, deletedAt: undefined };
    if (tenantId !== undefined) appUserTenantCriteria['tenantKey'] = tenantId;
    const appUserTenant = await em.findOne(AppuserTenant, appUserTenantCriteria);
    if (!appUserTenant) {
      throw new NotFoundError('App user tenant not found');
    }

    // Validate and fetch portfolio
    const portfolioCriteria: Record<string, unknown> = {
      closedAt: undefined,
      deletedAt: undefined,
      portfolioKey: portfolioId,
      portfolioOwnerAppuserKey: appuser,
    };
    if (tenantId !== undefined) portfolioCriteria['tenantKey'] = tenantId;
    const portfolio = await em.findOne(Portfolio, portfolioCriteria);
    if (!portfolio) {
      throw new NotFoundError('Portfolio not found');
    }

    // Resolve financial asset — creates it on demand from EODHD if not yet in DB
    const financialAsset = providedFinancialAsset ?? await resolveOrCreateFinancialAsset(assetSymbol, { skipStockSplitSync: true, ...(entityManager ? { em } : {}) });
    // financialAssetTypeKey isn't guaranteed populated here: resolveOrCreateFinancialAsset's
    // final lookup is a plain `em.findOne` with no `populate` option, and a caller-provided
    // `financialAsset` (e.g. CSV import) carries no such guarantee either. MikroORM leaves an
    // unpopulated to-one relation's non-PK properties `undefined` rather than throwing, so
    // skipping this would silently make every Savings Certificate look like "not a Savings
    // Certificate" below. Populate explicitly (a no-op if already loaded) before branching on it.
    await em.populate(financialAsset, ['financialAssetTypeKey']);
    const isSavingsCertificate = financialAsset.financialAssetTypeKey?.name === SAVINGS_CERTIFICATE_TYPE_NAME;

    // A Certificado de Aforro subscription is stored as `quantity` = principal in euros at a fixed
    // `unitPrice` of 1 (1 unit = €1 nominal, IGCP's own convention — design doc decision 5). The
    // entire accrual engine reads the lot's principal straight off `remaining_batch` (a *quantity*),
    // so a transaction like `{quantity: 1, unitPrice: 5000}` would be valued as a €1 subscription
    // while the FIFO/settlement pipeline books €5,000 — silently wrong in opposite directions.
    // Reject the bad input at the boundary rather than deriving principal as quantity × unitPrice
    // downstream: `settlementAmount` is already currency-converted elsewhere in the pipeline, so
    // reusing it as the principal would double-convert against `conversionRate` in
    // `enrichSavingsCertificateHoldings`.
    if (isSavingsCertificate && unitPrice !== 1) {
      throw new BadRequestError(
        'Savings Certificate transactions must have unitPrice = 1 (quantity is the subscribed principal in euros)',
      );
    }

    // Certificados de Aforro never have stock splits — skip the (real, rate-limited) EODHD
    // sync call entirely for this asset type rather than firing it pointlessly (RAD-445).
    if (!isSavingsCertificate) {
      try {
        await syncStockSplitsForAsset(financialAsset);
      } catch (err) {
        logger.warn({ err, symbol: assetSymbol }, 'Failed to sync stock splits for transaction asset');
      }
    }

    // Validate and fetch transaction type
    const financialTransactionType = await em.findOne(FinancialTransactionType, {
      financialTransactionTypeKey: financialTransactionTypeId,
    });
    if (!financialTransactionType) {
      throw new NotFoundError('Financial transaction type not found');
    }

    // Validate and fetch broker if provided
    let financialBroker: FinancialBroker | null = null;
    if (brokerId) {
      financialBroker = await em.findOne(FinancialBroker, {
        financialBrokerKey: brokerId,
      });
      if (!financialBroker) {
        throw new NotFoundError('Financial broker not found');
      }
    }

    // Validate and fetch settlement currency
    const settlementCurrency = await em.findOne(Currency, { currencyKey: settlementCurrencyId });
    if (!settlementCurrency) {
      throw new NotFoundError('Currency not found');
    }

    // Create transaction
    const financialTransaction = new FinancialTransaction();
    financialTransaction.appuserKey = appuser;
    financialTransaction.tenantKey = appUserTenant.tenantKey;
    financialTransaction.portfolioKey = portfolio;
    financialTransaction.financialAssetKey = financialAsset;
    financialTransaction.financialTransactionTypeKey = financialTransactionType;
    if (financialBroker) {
      financialTransaction.financialBrokerKey = financialBroker;
    }
    financialTransaction.transactionDate = transactionDate;
    const normalizedQuantity = normalizePortfolioTransactionQuantity(financialTransactionType.name, quantity);
    financialTransaction.quantity = normalizedQuantity;
    financialTransaction.settlementUnitAmount = unitPrice;
    const settlementAmount = unitPrice * normalizedQuantity;
    financialTransaction.settlementAmount = settlementAmount;
    financialTransaction.settlementCurrencyKey = settlementCurrency;
    financialTransaction.notes = notes;
    financialTransaction.internalTransactionId = params.internalTransactionId ?? generateManualPortfolioTransactionId();
    if (params.externalTransactionId) financialTransaction.externalTransactionId = params.externalTransactionId;

    // Handle original currency and exchange rate
    if (originalUnitPrice && originalCurrencyId) {
      const originalCurrency = await em.findOne(Currency, { currencyKey: originalCurrencyId });
      if (!originalCurrency) {
        throw new NotFoundError('Original currency not found');
      }
      financialTransaction.originalCurrencyKey = originalCurrency;
      financialTransaction.originalUnitAmount = originalUnitPrice;
      financialTransaction.originalAmount = originalUnitPrice * normalizedQuantity;
      financialTransaction.settlementExchangeRate = unitPrice / originalUnitPrice;
    }

    // Handle fee currency
    if (feeAmount && feeCurrencyId) {
      const feeCurrency = await em.findOne(Currency, { currencyKey: feeCurrencyId });
      if (!feeCurrency) {
        throw new NotFoundError('Fee currency not found');
      }
      financialTransaction.feeCurrencyKey = feeCurrency;
      financialTransaction.feeAmount = feeAmount;
    }

    // Convert to user's currency if necessary
    const userCurrency = appuser.currencyKey;
    const isTrxCurrencyDifferentFromUserCurrency = financialTransaction.settlementCurrencyKey !== userCurrency;
    if (isTrxCurrencyDifferentFromUserCurrency) {
      const exchangeRate = await em.findOne(ExchangeRate, {
        date: financialTransaction.transactionDate,
        fromCurrency: financialTransaction.settlementCurrencyKey,
        toCurrency: userCurrency,
      });
      if (exchangeRate) {
        financialTransaction.appuserSettlementAmount = financialTransaction.settlementAmount * exchangeRate.rate;
        financialTransaction.appuserCurrencyExchangeRate = exchangeRate.rate;
        financialTransaction.appuserUnitAmount = financialTransaction.settlementUnitAmount * exchangeRate.rate;
      }
    }

    try {
      await em.transactional(async (txEm) => {
        if (financialTransactionType.financialTransactionTypeKey === FINANCIAL_TRANSACTION_TYPES.SELL) {
          await this.lockPortfolioAssetTransactionTimeline(txEm, portfolioId, financialAsset);
          await this.validateTransactionTimelineDoesNotOversell(txEm, appuser, portfolioId, financialAsset, {
            financialTransactionTypeKey: financialTransactionType,
            quantity: normalizedQuantity,
            transactionDate,
          });
        }
        txEm.persist(financialTransaction);
        // taxExempt only means anything for accrual-mode series (C/D/E/F): the detail row feeds
        // the accrual engine's tax-exempt-withholding branch. Séries A/B (RAD-446) are
        // static-valuation and have no tax-exempt/accrual concept, so — same as every non-Savings-
        // Certificate asset type — taxExempt is silently ignored for them: no error, no detail row,
        // since it's an optional field and a client sending `false` (its default) must not error.
        if (isSavingsCertificate && CERTIFICADO_AFORRO_SERIES_CONSTANTS[assetSymbol]?.valuationMode === 'accrual') {
          const certificadoAforroSubscriptionDetail = new CertificadoAforroSubscriptionDetail();
          certificadoAforroSubscriptionDetail.transactionKey = financialTransaction;
          certificadoAforroSubscriptionDetail.taxExempt = params.taxExempt ?? false;
          txEm.persist(certificadoAforroSubscriptionDetail);
        }
        await txEm.flush();
      }, { propagation: TransactionPropagation.NESTED });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictError('A transaction with this identity already exists');
      }
      throw error;
    }

    if (!maintenance.skip) {
      // Best-effort: the transaction above already committed. A failure here (asset-price
      // provider hiccup, backfill timeout) must not turn a persisted transaction into a
      // response the caller reads as failure and retries — retrying then hits the unique
      // constraint on a transaction that was never actually missing (RAD-603).
      try {
        // Ensure recent asset price is available
        await assetPriceService.ensureRecentAssetPrice(financialAsset);

        if (financialTransactionType.name === 'BUY') {
          // v1 keeps this bounded by the client timeout; we await so failures are visible in logs
          // without letting the transaction path grow unbounded.
          await this.triggerHistoricalAssetPriceBackfill(portfolioId, {
            financialAssetId: financialAsset.financialAssetKey,
            symbol: financialAsset.symbol,
            transactionDate: toYmd(transactionDate),
          }, maintenance.enqueue);
        }

        // Update portfolio snapshots from the affected transaction date
        await this.refreshSnapshotsFromDate(portfolioId, transactionDate);
      } catch (err) {
        logger.warn(
          { err, portfolioId, transactionKey: financialTransaction.transactionKey },
          'Post-commit portfolio transaction maintenance failed; the transaction itself was saved',
        );
      }
    }
  }

  /**
   * Update an existing portfolio transaction
   */
  async updatePortfolioTransaction(
    appuser: Appuser,
    portfolioId: number,
    transactionId: number,
    params: UpdateTransactionParams,
    deps: { enqueue: Enqueue },
  ): Promise<void> {
    // Fetch existing transaction
    const transaction = await DI.em.findOne(
      FinancialTransaction,
      {
        deletedAt: undefined,
        portfolioKey: { portfolioKey: portfolioId },
        transactionKey: transactionId,
      },
      { populate: ['financialAssetKey', 'financialTransactionTypeKey', 'portfolioKey'] },
    );

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    const originalTransactionDate = transaction.transactionDate;
    const originalTransactionTypeName = transaction.financialTransactionTypeKey?.name;
    // Update fields if provided
    if (params.transactionDate !== undefined) {
      transaction.transactionDate = params.transactionDate;
    }

    if (params.financialTransactionTypeId !== undefined) {
      const transactionType = await DI.em.findOne(FinancialTransactionType, {
        financialTransactionTypeKey: params.financialTransactionTypeId,
      });
      if (!transactionType) {
        throw new NotFoundError('Financial transaction type not found');
      }
      transaction.financialTransactionTypeKey = transactionType;
    }

    if (params.brokerId !== undefined) {
      if (params.brokerId === null) {
        transaction.financialBrokerKey = undefined;
      } else {
        const broker = await DI.em.findOne(FinancialBroker, { financialBrokerKey: params.brokerId });
        if (!broker) {
          throw new NotFoundError('Broker not found');
        }
        transaction.financialBrokerKey = broker;
      }
    }

    if (params.quantity !== undefined) {
      transaction.quantity = params.quantity;
    }

    if (params.quantity !== undefined || params.financialTransactionTypeId !== undefined) {
      transaction.quantity = normalizePortfolioTransactionQuantity(transaction.financialTransactionTypeKey?.name, transaction.quantity);
    }

    // A Certificado de Aforro subscription stores `quantity` as principal in euros at a fixed
    // `unitPrice` of 1 (see the identical guard in createPortfolioTransaction). Without this check
    // a valid Savings Certificate transaction (e.g. `{quantity: 5000, unitPrice: 1}`) could be
    // edited to `{quantity: 1, unitPrice: 5000}`, reproducing the same silent-wrong-valuation bug
    // via the update path (RAD-445).
    if (params.unitPrice !== undefined && transaction.financialAssetKey) {
      await DI.em.populate(transaction.financialAssetKey, ['financialAssetTypeKey']);
      const isSavingsCertificate = transaction.financialAssetKey.financialAssetTypeKey?.name === SAVINGS_CERTIFICATE_TYPE_NAME;
      if (isSavingsCertificate && params.unitPrice !== 1) {
        throw new BadRequestError(
          'Savings Certificate transactions must have unitPrice = 1 (quantity is the subscribed principal in euros)',
        );
      }
    }

    if (params.unitPrice !== undefined) {
      transaction.settlementUnitAmount = params.unitPrice;
    }

    // Recalculate settlement amount if quantity or price changed
    if (params.quantity !== undefined || params.unitPrice !== undefined || params.financialTransactionTypeId !== undefined) {
      transaction.settlementAmount = transaction.settlementUnitAmount * transaction.quantity;
    }

    if (params.settlementCurrencyId !== undefined) {
      const currency = await DI.em.findOne(Currency, { currencyKey: params.settlementCurrencyId });
      if (!currency) {
        throw new NotFoundError('Settlement currency not found');
      }
      transaction.settlementCurrencyKey = currency;
    }

    if (params.feeAmount !== undefined) {
      transaction.feeAmount = params.feeAmount ?? undefined;
    }

    if (params.feeCurrencyId !== undefined) {
      if (params.feeCurrencyId === null) {
        transaction.feeCurrencyKey = undefined;
      } else {
        const feeCurrency = await DI.em.findOne(Currency, { currencyKey: params.feeCurrencyId });
        if (!feeCurrency) {
          throw new NotFoundError('Fee currency not found');
        }
        transaction.feeCurrencyKey = feeCurrency;
      }
    }

    if (params.originalUnitPrice !== undefined) {
      transaction.originalUnitAmount = params.originalUnitPrice ?? undefined;
      if (transaction.originalUnitAmount && transaction.quantity) {
        transaction.originalAmount = transaction.originalUnitAmount * transaction.quantity;
      } else {
        transaction.originalAmount = undefined;
      }
    }

    if (params.originalCurrencyId !== undefined) {
      if (params.originalCurrencyId === null) {
        transaction.originalCurrencyKey = undefined;
      } else {
        const originalCurrency = await DI.em.findOne(Currency, { currencyKey: params.originalCurrencyId });
        if (!originalCurrency) {
          throw new NotFoundError('Original currency not found');
        }
        transaction.originalCurrencyKey = originalCurrency;
      }
    }

    if (params.notes !== undefined) {
      transaction.notes = params.notes ?? undefined;
    }

    // Recalculate exchange rate if original and settlement prices are set
    if (transaction.originalUnitAmount && transaction.settlementUnitAmount) {
      transaction.settlementExchangeRate = transaction.settlementUnitAmount / transaction.originalUnitAmount;
    } else {
      transaction.settlementExchangeRate = undefined;
    }

    // Recalculate user currency conversion if needed
    const userCurrency = appuser.currencyKey;
    if (transaction.settlementCurrencyKey !== userCurrency && transaction.transactionDate) {
      const exchangeRate = await DI.em.findOne(ExchangeRate, {
        date: transaction.transactionDate,
        fromCurrency: transaction.settlementCurrencyKey,
        toCurrency: userCurrency,
      });
      if (exchangeRate) {
        transaction.appuserSettlementAmount = transaction.settlementAmount * exchangeRate.rate;
        transaction.appuserCurrencyExchangeRate = exchangeRate.rate;
        transaction.appuserUnitAmount = transaction.settlementUnitAmount * exchangeRate.rate;
      }
    }

    if (transaction.financialAssetKey) {
      await DI.em.transactional(async (entityManager) => {
        await this.lockPortfolioAssetTransactionTimeline(entityManager, portfolioId, transaction.financialAssetKey!);
        await this.validateTransactionTimelineDoesNotOversell(
          entityManager,
          appuser,
          portfolioId,
          transaction.financialAssetKey!,
          {
            financialTransactionTypeKey: transaction.financialTransactionTypeKey,
            quantity: transaction.quantity,
            transactionDate: transaction.transactionDate,
            transactionKey: transaction.transactionKey,
          },
        );
        await entityManager.flush();
      });
    } else {
      await DI.em.flush();
    }

    // Ensure recent asset price is available
    if (transaction.financialAssetKey) {
      await assetPriceService.ensureRecentAssetPrice(transaction.financialAssetKey);
    }

    const currentTransactionTypeName = transaction.financialTransactionTypeKey?.name;
    const dateChanged = params.transactionDate !== undefined && originalTransactionDate?.getTime() !== transaction.transactionDate?.getTime();
    const changedIntoBuy = originalTransactionTypeName !== 'BUY' && currentTransactionTypeName === 'BUY';
    if (currentTransactionTypeName === 'BUY' && (dateChanged || changedIntoBuy) && transaction.financialAssetKey) {
      const replayFromDate = dateChanged
        ? originalTransactionDate && transaction.transactionDate
          ? originalTransactionDate < transaction.transactionDate
            ? originalTransactionDate
            : transaction.transactionDate
          : originalTransactionDate ?? transaction.transactionDate
        : transaction.transactionDate;

      if (replayFromDate) {
        await this.triggerHistoricalAssetPriceBackfill(portfolioId, {
          earliestTransactionDate: originalTransactionDate ? toYmd(originalTransactionDate) : undefined,
          financialAssetId: transaction.financialAssetKey.financialAssetKey,
          symbol: transaction.financialAssetKey.symbol,
          transactionDate: toYmd(replayFromDate),
        }, deps.enqueue);
      }
    }

    // Update portfolio snapshots from the affected transaction date
    const replayFromDate =
      originalTransactionDate && transaction.transactionDate
        ? originalTransactionDate < transaction.transactionDate
          ? originalTransactionDate
          : transaction.transactionDate
        : originalTransactionDate ?? transaction.transactionDate;

    await this.refreshSnapshotsFromDate(portfolioId, replayFromDate);
  }

  /**
   * Delete (soft delete) a portfolio transaction
   */
  async deletePortfolioTransaction(appuser: Appuser, portfolioId: number, transactionId: number): Promise<void> {
    const transaction = await DI.em.findOne(
      FinancialTransaction,
      {
        deletedAt: undefined,
        portfolioKey: { portfolioKey: portfolioId },
        transactionKey: transactionId,
      },
      { populate: ['financialAssetKey'] },
    );

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    if (transaction.financialAssetKey) {
      await DI.em.transactional(async (entityManager) => {
        await this.lockPortfolioAssetTransactionTimeline(entityManager, portfolioId, transaction.financialAssetKey!);
        await this.validateTransactionTimelineDoesNotOversell(
          entityManager,
          appuser,
          portfolioId,
          transaction.financialAssetKey!,
          undefined,
          transaction.transactionKey,
        );
        transaction.deletedAt = new Date();
        await entityManager.flush();
      });
    } else {
      transaction.deletedAt = new Date();
      await DI.em.flush();
    }

    // Update portfolio snapshots from the earliest transaction
    await this.refreshSnapshotsFromDate(portfolioId, transaction.transactionDate);
  }
}

export default new PortfolioTransactionService();

/* eslint-enable perfectionist/sort-classes */
