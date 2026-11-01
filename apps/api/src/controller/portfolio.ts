import { randomUUID } from 'node:crypto';

import { format } from 'date-fns';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { pick } from 'lodash-es';

import { anyOf, sqlQuery } from '@app/database/sql';
import { enqueuePortfolioSnapshotManualJob } from '@app/jobs/portfolio-snapshot.queue';
import { zParse } from '@app/validators/parser';
import {
  createPortfolioImportSessionRequestSchema,
  createPortfolioRequestSchema,
  createPortfolioTransactionRequestSchema,
  deletePortfolioRequestSchema,
  deletePortfolioTransactionRequestSchema,
  getAggregateAllocationRequestSchema,
  getAggregateDashboardRequestSchema,
  getAggregatePerformanceRequestSchema,
  getAggregateTopMoversRequestSchema,
  getHoldingMarketDataRequestSchema,
  getPortfolioAllocationRequestSchema,
  getPortfolioDashboardRequestSchema,
  getPortfolioHistoryStatusRequestSchema,
  getPortfolioHoldingsRequestSchema,
  getPortfolioPerformanceRequestSchema,
  getPortfolioRequestSchema,
  getPortfoliosMetricsRequestSchema,
  getPortfoliosTransactionRequestSchema,
  getPortfolioTopMoversRequestSchema,
  getPortfolioTransactionRequestSchema,
  updatePortfolioRequestSchema,
  updatePortfolioTransactionRequestSchema,
} from '@app/validators/portfolio';
import { AppuserTenant } from '@entity/AppuserTenant';
import { AssetClass } from '@entity/AssetClass';
import { Currency } from '@entity/Currency';
import { FinancialBroker } from '@entity/FinancialBroker';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import { authedContext } from '@middleware/authed-context';
import eodhd from '@service/market-data/eodhd.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import portfolioImportSessionService from '@service/portfolio/portfolio-import-session.service';
import s3Service from '@service/storage/s3';
import { BadRequestError, InternalServerError, NotFoundError } from '@utils/errors';

import { DI } from '../app.js';
import portfolioDashboardService from '../services/portfolio/portfolio-dashboard.service.js';
import portfolioHistoryStatusService from '../services/portfolio/portfolio-history-status.service.js';
import portfolioHoldingsService from '../services/portfolio/portfolio-holdings.service.js';
import portfolioMetricsService from '../services/portfolio/portfolio-metrics.service.js';
import portfolioTransactionService from '../services/portfolio/portfolio-transaction.service.js';


export async function createPortfolio(req: Request, res: Response) {
  const { user } = authedContext(req);
  const {
    body: { currencyId, name },
  } = await zParse(createPortfolioRequestSchema, req);
  const appUserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(user);
  if (!appUserTenant) {
    throw new BadRequestError("User doesn't have AppuserTenant");
  }
  const currencyKey = await DI.em.findOne(Currency, { currencyKey: currencyId });
  if (!currencyKey) {
    throw new InternalServerError('Currency not found');
  }
  const portfolio = new Portfolio();
  portfolio.name = name;
  portfolio.currencyKey = currencyKey;
  portfolio.portfolioOwnerAppuserKey = appUserTenant.appuserKey;
  portfolio.tenantKey = appUserTenant.tenantKey;
  await DI.em.persist(portfolio).flush();

  return res.status(201).json({
    portfolio: {
      portfolioKey: portfolio.portfolioKey,
    },
  });
}

export async function createPortfolioImportSession(req: Request, res: Response) {
  const { body: { brokerId }, params: { portfolioId } } = await zParse(createPortfolioImportSessionRequestSchema, req);
  if (!req.user) throw new BadRequestError('Unauthorized');
  if (!req.tenant) throw new NotFoundError('Tenant not found');

  const token = randomUUID().replaceAll('-', '');
  const bucket = s3Service.getPortfolioCsvBucketName();
  const preliminaryKey = `portfolio-import-sessions/${portfolioId}/pending/${token}.csv`;
  const session = await portfolioImportSessionService.createSession({
    appuser: req.user,
    brokerId,
    correlationId: `portfolio.csv-import-session:${portfolioId}:pending:${token}`,
    portfolioId,
    s3Bucket: bucket,
    s3Key: preliminaryKey,
    tenant: req.tenant,
  });
  const upload = await s3Service.generatePresignedUrlForPortfolioImportSessionCsv({
    importSessionId: session.portfolioImportSessionKey,
    portfolioId,
    token,
  });

  session.correlationId = `portfolio.csv-import-session:${portfolioId}:${session.portfolioImportSessionKey}:${token}`;
  session.s3Key = upload.key;
  await DI.em.persist(session).flush();

  return res.status(201).json({
    broker: session.financialBrokerKey ? { id: session.financialBrokerKey.financialBrokerKey, name: session.financialBrokerKey.name } : undefined,
    correlationId: session.correlationId,
    expiresAt: session.expiresAt?.toISOString(),
    importSessionId: session.portfolioImportSessionKey,
    maxUploadSizeBytes: upload.maxUploadSizeBytes,
    s3Bucket: bucket,
    s3Key: upload.key,
    status: session.status,
    uploadFields: undefined,
    uploadHeaders: upload.uploadHeaders,
    uploadMethod: upload.uploadMethod,
    uploadUrl: upload.presignedUrl,
  });
}

export async function createPortfolioTransaction(req: Request, res: Response) {
  const { user } = authedContext(req);
  const {
    body: {
      assetSymbol,
      brokerId,
      feeAmount,
      feeCurrencyId,
      financialTransactionTypeId,
      notes,
      originalCurrencyId,
      originalUnitPrice,
      quantity,
      settlementCurrencyId,
      taxExempt,
      transactionDate,
      unitPrice,
    },
    params: { portfolioId },
  } = await zParse(createPortfolioTransactionRequestSchema, req);

  await portfolioTransactionService.createPortfolioTransaction(user, {
    assetSymbol,
    brokerId,
    feeAmount,
    feeCurrencyId,
    financialTransactionTypeId,
    notes,
    originalCurrencyId,
    originalUnitPrice,
    portfolioId,
    quantity,
    settlementCurrencyId,
    taxExempt,
    transactionDate,
    unitPrice,
  }, undefined, { enqueue: req.enqueue });

  return res.sendStatus(201);
}

export async function deletePortfolio(req: Request, res: Response) {
  const {
    params: { portfolioId },
  } = await zParse(deletePortfolioRequestSchema, req);

  const portfolio = await DI.em.findOne(Portfolio, {
    deletedAt: undefined,
    portfolioKey: portfolioId,
  }, { populate: ['currencyKey'] });
  if (!portfolio) {
    throw new NotFoundError('Portfolio not found');
  }

  portfolio.closedAt = new Date();
  portfolio.deletedAt = new Date();
  await DI.em.flush();

  return res.sendStatus(204);
}

export async function deletePortfolioTransaction(req: Request, res: Response) {
  const { user } = authedContext(req);
  const {
    params: { portfolioId, transactionId },
  } = await zParse(deletePortfolioTransactionRequestSchema, req);

  await portfolioTransactionService.deletePortfolioTransaction(user, portfolioId, transactionId);

  return res.sendStatus(204);
}

export async function getBrokers(_req: Request, res: Response) {
  const brokers = await DI.em.find(FinancialBroker, {});
  return res.json({ brokers });
}

export async function getDividendIncome(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const income = await portfolioHoldingsService.getDividendIncome(user.appuserKey, undefined, tenant.tenantKey);
  return res.json(income);
}

export async function getPortfolio(req: Request, res: Response) {
  const {
    params: { portfolioId },
  } = await zParse(getPortfolioRequestSchema, req);
  const portfolio = await DI.em.findOne(Portfolio, {
    deletedAt: undefined,
    portfolioKey: portfolioId,
  }, { populate: ['currencyKey'] });
  if (!portfolio) {
    throw new NotFoundError('Portfolio not found');
  }
  const transformedData = {
    ...pick(portfolio, ['portfolioKey', 'name', 'description', 'targetAllocation']),
    currencyKey: { code: portfolio.currencyKey.code },
  };
  return res.json({ portfolio: transformedData });
}

export async function getPortfolioDividendIncome(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { portfolioId },
  } = await zParse(getPortfolioRequestSchema, req);
  const income = await portfolioHoldingsService.getDividendIncome(user.appuserKey, portfolioId, tenant.tenantKey);
  return res.json(income);
}

export async function getPortfolioHistoryStatus(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { portfolioId },
  } = await zParse(getPortfolioHistoryStatusRequestSchema, req);
  const status = await portfolioHistoryStatusService.getPortfolioHistoryStatus(user, portfolioId, tenant.tenantKey);
  return res.status(200).json(status);
}

export async function getPortfolioHoldings(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { portfolioId },
  } = await zParse(getPortfolioHoldingsRequestSchema, req);
  const holdings = await portfolioHoldingsService.getPortfolioHoldings(user, portfolioId, tenant.tenantKey);
  return res.json({ holdings });
}

export async function getPortfolios(req: Request, res: Response) {
  const { user } = authedContext(req);
  const portfolios = await DI.em.find(
    Portfolio,
    { deletedAt: undefined },
    { populate: ['currencyKey'] },
  );

  // Get latest snapshot balance per portfolio in a single query.
  // Raw SQL bypasses the ORM filters (see `net-worth.service.ts#getPortfolioRows`), so
  // scope to the caller's own (already tenant-filtered) portfolios, and exclude
  // soft-deleted snapshots.
  const portfolioKeys = portfolios.map((portfolio) => portfolio.portfolioKey);
  const latestSnapshots = portfolioKeys.length === 0 ? [] : await sqlQuery(DI.em)
    .selectFrom('portfolio_snapshot as ps')
    .innerJoin(
      sql<{ max_date: unknown; portfolio_key: unknown }>`(SELECT portfolio_key, MAX(snapshot_date) as max_date FROM portfolio_snapshot
           WHERE deleted_at IS NULL AND portfolio_key = ANY(${portfolioKeys}) GROUP BY portfolio_key)`.as('latest'),
      (join) => join.onRef('ps.portfolio_key', '=', 'latest.portfolio_key').onRef('ps.snapshot_date', '=', 'latest.max_date'),
    )
    .select([
      'ps.portfolio_key',
      sql<null | number>`COALESCE(ps.appuser_currency_total_value, ps.total_value)`.as('balance'),
    ])
    .where('ps.deleted_at', 'is', null)
    .where(anyOf('ps.portfolio_key', portfolioKeys))
    .execute();

  const balanceMap = new Map<number, number>();
  for (const row of latestSnapshots) {
    balanceMap.set(row.portfolio_key as number, Number(row.balance) || 0);
  }

  const transformedData = portfolios.map((t) => ({
    ...pick(t, ['portfolioKey', 'name', 'description', 'currencyKey.code']),
    appuserCurrencyCode: user.currencyKey.code,
    balance: balanceMap.get(t.portfolioKey) ?? 0,
  }));
  return res.json({ portfolios: transformedData });
}

export async function getPortfoliosHoldings(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const holdings = await portfolioHoldingsService.getPortfoliosHoldings(user, tenant.tenantKey);
  return res.json({ holdings });
}

export async function getPortfoliosMetrics(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    query: { fromDate },
  } = await zParse(getPortfoliosMetricsRequestSchema, req);
  return res.json(await portfolioMetricsService.getPortfoliosMetrics(user, fromDate, tenant.tenantKey));
}

export async function getPortfoliosTransactions(req: Request, res: Response) {
  const { user } = authedContext(req);
  const {
    query: { fromDate, limit, ticker, toDate },
  } = await zParse(getPortfoliosTransactionRequestSchema, req);
  const transactions = await portfolioTransactionService.getPortfoliosTransactions(user, fromDate, toDate, ticker, limit);
  return res.json({ transactions });
}

export async function getPortfolioTransactions(req: Request, res: Response) {
  const { user } = authedContext(req);
  const {
    params: { portfolioId },
    query: { fromDate, limit, toDate },
  } = await zParse(getPortfolioTransactionRequestSchema, req);
  const transactions = await portfolioTransactionService.getPortfolioTransactions(
    user,
    portfolioId,
    fromDate,
    toDate,
    limit,
  );
  return res.json({ transactions });
}

export async function getTransactionTypes(_req: Request, res: Response) {
  const transactionTypes = await DI.em.find(FinancialTransactionType, {});
  return res.json({ transactionTypes });
}

export async function rebuildPortfolioSnapshot(req: Request, res: Response) {
  const { params: { portfolioId } } = await zParse(getPortfolioRequestSchema, req);
  const numericPortfolioId = portfolioId;
  const portfolio = await DI.em.findOne(Portfolio, { deletedAt: undefined, portfolioKey: portfolioId }, { populate: ['tenantKey'] });
  if (!portfolio) throw new NotFoundError('Portfolio not found');
  const correlationId = randomUUID();
  await backgroundOperationService.createQueuedOperation({
    appuserKey: portfolio.portfolioOwnerAppuserKey,
    correlationId,
    operationType: 'portfolio.snapshot',
    resourceId: `portfolio:${portfolioId}`,
    retryable: false,
    tenantKey: portfolio.tenantKey.tenantKey,
  });
  try {
    const jobId = await enqueuePortfolioSnapshotManualJob({ correlationId, portfolioId: numericPortfolioId }, { enqueue: req.enqueue, singletonKey: correlationId });
    if (!jobId) {
      await backgroundOperationService.markNeedsAction(correlationId, 'portfolio.snapshot:enqueue-null', 'portfolio.snapshot:queueing');
      throw new InternalServerError('Portfolio snapshot queue returned no job id');
    }
    const attached = await backgroundOperationService.attachQueueJob(correlationId, String(jobId));
    if (!attached) {
      await backgroundOperationService.markNeedsAction(correlationId, 'portfolio.snapshot:attach-false', 'portfolio.snapshot:queueing');
      throw new InternalServerError('Portfolio snapshot job accepted but could not be attached');
    }
  } catch (error) {
    if (!(error instanceof InternalServerError)) await backgroundOperationService.markNeedsAction(correlationId, 'portfolio.snapshot:queue-error', 'portfolio.snapshot:queueing');
    throw error;
  }
  return res.status(202).json({ correlationId, status: 'queued' });
}

export async function updatePortfolio(req: Request, res: Response) {
  const {
    body: { benchmarkSymbol, currencyId, description, excluded, favored, name, targetAllocation },
    params: { portfolioId },
  } = await zParse(updatePortfolioRequestSchema, req);

  const portfolio = await DI.em.findOne(Portfolio, {
    deletedAt: undefined,
    portfolioKey: portfolioId,
  });
  if (!portfolio) {
    throw new NotFoundError('Portfolio not found');
  }

  if (name !== undefined) portfolio.name = name;
  if (description !== undefined) portfolio.description = description ?? undefined;
  if (excluded !== undefined) portfolio.excluded = excluded;
  if (favored !== undefined) portfolio.favored = favored;
  if (benchmarkSymbol !== undefined) portfolio.benchmarkSymbol = benchmarkSymbol;
  if (targetAllocation !== undefined && targetAllocation !== null) {
    const assetClasses = await DI.em.find(AssetClass, {});
    const validNames = new Set(assetClasses.map((assetClass) => assetClass.name));
    const invalidKeys = Object.keys(targetAllocation).filter((key) => !validNames.has(key));
    if (invalidKeys.length > 0) {
      throw new BadRequestError(`Unknown asset class(es) in targetAllocation: ${invalidKeys.join(', ')}`);
    }
  }
  if (targetAllocation !== undefined) portfolio.targetAllocation = targetAllocation ?? undefined;

  if (currencyId !== undefined) {
    const currency = await DI.em.findOne(Currency, { currencyKey: currencyId });
    if (!currency) {
      throw new NotFoundError('Currency not found');
    }
    portfolio.currencyKey = currency;
  }

  await DI.em.flush();

  return res.json({ portfolio: pick(portfolio, ['portfolioKey', 'name', 'description', 'currencyKey.code', 'excluded', 'favored', 'benchmarkSymbol', 'targetAllocation']) });
}

export async function updatePortfolioTransaction(req: Request, res: Response) {
  const { user } = authedContext(req);
  const {
    body,
    params: { portfolioId, transactionId },
  } = await zParse(updatePortfolioTransactionRequestSchema, req);

  await portfolioTransactionService.updatePortfolioTransaction(user, portfolioId, transactionId, body, { enqueue: req.enqueue });

  return res.sendStatus(200);
}

// Dashboard endpoints - Aggregate (all portfolios)
export async function getAggregateDashboard(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    query: { include, period },
  } = await zParse(getAggregateDashboardRequestSchema, req);
  const dashboard = await portfolioDashboardService.getAggregateDashboard(user, period || 'YTD', tenant.tenantKey, {
    includeFeeConversion: include === 'feeConversion',
  });
  return res.json(dashboard);
}

export async function getAllocation(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  await zParse(getAggregateAllocationRequestSchema, req);
  const allocation = await portfolioDashboardService.getAllocation(user, null, tenant.tenantKey);
  return res.json(allocation);
}

export async function getPerformance(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    query: { period },
  } = await zParse(getAggregatePerformanceRequestSchema, req);
  const performance = await portfolioDashboardService.getPerformanceData(user, null, period || 'YTD', tenant.tenantKey);
  return res.json(performance);
}

export async function getTopMovers(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    query: { limit, period },
  } = await zParse(getAggregateTopMoversRequestSchema, req);
  const topMovers = await portfolioDashboardService.getTopMovers(user, null, period || 'YTD', limit || 5, tenant.tenantKey);
  return res.json(topMovers);
}

// Dashboard endpoints - Individual portfolio
export async function getHoldingAnalystData(req: Request, _res: Response) {
  await zParse(getHoldingMarketDataRequestSchema, req);
  // Not covered by the current EODHD plan tier (Fundamentals-gated, same as
  // financial-markets.ts's getFundamentals/getEarnings).
  throw new NotFoundError('Analyst data is temporarily unavailable');
}

export async function getHoldingValuation(req: Request, _res: Response) {
  await zParse(getHoldingMarketDataRequestSchema, req);
  throw new NotFoundError('Valuation data is temporarily unavailable');
}

export async function getPortfolioAllocation(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { portfolioId },
  } = await zParse(getPortfolioAllocationRequestSchema, req);
  const allocation = await portfolioDashboardService.getAllocation(user, portfolioId, tenant.tenantKey);
  return res.json(allocation);
}

export async function getPortfolioCalendar(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const holdings = await portfolioHoldingsService.getPortfoliosHoldings(user, tenant.tenantKey);
  const symbols = [...new Set(holdings.filter((h) => !h.isInvalid).map((h) => h.financialAssetSymbol))];
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + 120);
  const fromStr = format(from, 'yyyy-MM-dd');
  const toStr = format(to, 'yyyy-MM-dd');

  // Earnings calendar is Fundamentals-tier, not covered by the current EODHD
  // plan — always empty rather than calling a provider.
  const earnings: unknown[] = [];

  // Unlike earnings, EODHD's /div endpoint DOES return forward-looking
  // (declared-but-not-yet-ex) dividend dates — verified live on 2026-08-05
  // against AAPL/MSFT/JNJ/KO/PG.US: e.g. AAPL's 2026-08-10 ex-dividend row
  // carried declarationDate 2026-07-30, five days before "today". So this
  // half of the endpoint calls EODHD rather than being stubbed to [].
  const dividendResults = await Promise.all(
    symbols.map(async (s) => {
      try {
        // Row type is inferred rather than annotated explicitly:
        // EodhdTypes.DividendDataPoint can't be referenced in a type
        // position (TS2749; see financial-markets.ts). eodhd.getDividends()'s
        // own return type is unaffected and correctly infers this shape.
        const rows = await eodhd.getDividends(s, { from: fromStr, to: toStr });
        // EODHD's rows don't carry a `symbol` field, so tag
        // each row with the symbol it was queried for before merging.
        return rows.map((row) => ({ ...row, symbol: s }));
      } catch {
        // Preserve the endpoint's existing per-symbol fault tolerance: one
        // symbol's provider failure shouldn't blank out the rest.
        return [];
      }
    }),
  );

  const dividends = dividendResults
    .flat()
    .filter((row) => row.date >= fromStr && row.date <= toStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.json({
    dividends,
    earnings,
  });
}

export async function getPortfolioDashboard(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { portfolioId },
    query: { include, period },
  } = await zParse(getPortfolioDashboardRequestSchema, req);
  const dashboard = await portfolioDashboardService.getPortfolioDashboard(user, portfolioId, period || 'YTD', tenant.tenantKey, {
    includeFeeConversion: include === 'feeConversion',
  });
  return res.json(dashboard);
}

export async function getPortfolioPerformance(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { portfolioId },
    query: { period },
  } = await zParse(getPortfolioPerformanceRequestSchema, req);
  const performance = await portfolioDashboardService.getPerformanceData(user, portfolioId, period || 'YTD', tenant.tenantKey);
  return res.json(performance);
}

export async function getPortfolioTopMovers(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { portfolioId },
    query: { limit, period },
  } = await zParse(getPortfolioTopMoversRequestSchema, req);
  const topMovers = await portfolioDashboardService.getTopMovers(user, portfolioId, period || 'YTD', limit || 5, tenant.tenantKey);
  return res.json(topMovers);
}
