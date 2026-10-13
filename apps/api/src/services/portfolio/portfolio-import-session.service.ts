import { type EntityManager, LockMode } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { FinancialBroker } from '@entity/FinancialBroker';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { NotFoundError } from '@utils/errors';

export const PORTFOLIO_IMPORT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateDraftPortfolioImportRowsInput {
  appuser: Appuser;
  importSessionId: number;
  rows: {
    failureReason?: string;
    internalTransactionId?: string;
    normalizedJson?: Record<string, unknown>;
    rawJson: Record<string, unknown>;
    rowNumber: number;
    skipReason?: string;
    status?: PortfolioImportRowStatus;
  }[];
  tenant: { tenantKey: number };
}

export interface CreatePortfolioImportSessionInput {
  appuser: Appuser;
  brokerId?: number;
  columnMappingJson?: Record<string, unknown>;
  correlationId: string;
  expiresAt?: Date;
  objectEtag?: string;
  portfolioId: number;
  s3Bucket: string;
  s3Key: string;
  summaryJson?: Record<string, unknown>;
  tenant: { tenantKey: number };
}

export interface GetOwnedPortfolioImportSessionInput {
  appuser: Appuser;
  importSessionId: number;
  tenant: { tenantKey: number };
}

export interface MarkPortfolioImportSessionWorkerFailureInput {
  error: unknown;
  expectedStatus: PortfolioImportSessionStatus;
  importSessionId: number;
  summaryKey: 'importWorkerError' | 'parseWorkerError';
}

export interface UpdatePortfolioImportSessionStatusInput {
  appuser: Appuser;
  importSessionId: number;
  status: PortfolioImportSessionStatus;
  summaryJson?: Record<string, unknown>;
  tenant: { tenantKey: number };
}

interface GetOwnedPortfolioImportSessionOptions {
  em?: EntityManager;
  lockMode?: LockMode;
}

class PortfolioImportSessionService {
  async createDraftRows(input: CreateDraftPortfolioImportRowsInput): Promise<PortfolioImportRow[]> {
    const session = await this.getOwnedSession(input);
    const rows = input.rows.map((row) => Object.assign(new PortfolioImportRow(), {
      failureReason: row.failureReason,
      internalTransactionId: row.internalTransactionId,
      normalizedJson: row.normalizedJson,
      portfolioImportSessionKey: session,
      rawJson: row.rawJson,
      rowNumber: row.rowNumber,
      skipReason: row.skipReason,
      status: row.status ?? PortfolioImportRowStatus.VALID,
    }));

    await DI.em.persist(rows).flush();
    return rows;
  }

  async createSession(input: CreatePortfolioImportSessionInput): Promise<PortfolioImportSession> {
    const portfolio = await DI.em.findOne(Portfolio, {
      closedAt: undefined,
      deletedAt: undefined,
      portfolioKey: input.portfolioId,
      portfolioOwnerAppuserKey: input.appuser,
      tenantKey: input.tenant,
    }, { populate: ['portfolioOwnerAppuserKey', 'tenantKey'] });

    if (!portfolio) throw new NotFoundError('Portfolio not found');
    const broker = input.brokerId === undefined ? undefined : await DI.em.findOne(FinancialBroker, {
      financialBrokerKey: input.brokerId,
    });
    if (input.brokerId !== undefined && !broker) throw new NotFoundError('Broker not found');

    const session = Object.assign(new PortfolioImportSession(), {
      appuserKey: input.appuser,
      columnMappingJson: input.columnMappingJson,
      correlationId: input.correlationId,
      expiresAt: input.expiresAt ?? new Date(Date.now() + PORTFOLIO_IMPORT_SESSION_TTL_MS),
      financialBrokerKey: broker,
      objectEtag: input.objectEtag,
      portfolioKey: portfolio,
      s3Bucket: input.s3Bucket,
      s3Key: input.s3Key,
      status: PortfolioImportSessionStatus.WAITING_FOR_UPLOAD,
      summaryJson: input.summaryJson,
      tenantKey: portfolio.tenantKey,
    });

    await DI.em.persist(session).flush();
    return session;
  }

  async getOwnedSession(input: GetOwnedPortfolioImportSessionInput, options: GetOwnedPortfolioImportSessionOptions = {}): Promise<PortfolioImportSession> {
    const em = options.em ?? DI.em;
    const session = await em.findOne(PortfolioImportSession, {
      appuserKey: input.appuser,
      deletedAt: undefined,
      portfolioImportSessionKey: input.importSessionId,
      tenantKey: input.tenant,
    }, { lockMode: options.lockMode, populate: ['portfolioKey', 'tenantKey', 'financialBrokerKey'] });

    if (!session) throw new NotFoundError('Import session not found');
    return session;
  }

  isExpired(session: Pick<PortfolioImportSession, 'expiredAt' | 'expiresAt'>) {
    return Boolean(session.expiredAt) || Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now());
  }

  async markWorkerFailure(input: MarkPortfolioImportSessionWorkerFailureInput): Promise<boolean> {
    return DI.em.transactional(async (em) => {
      const session = await em.findOne(PortfolioImportSession, {
        deletedAt: undefined,
        portfolioImportSessionKey: input.importSessionId,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE });

      if (!session || session.status !== input.expectedStatus) return false;

      const message = input.error instanceof Error ? input.error.message : 'Worker failed';
      session.status = PortfolioImportSessionStatus.FAILED;
      session.summaryJson = {
        ...(session.summaryJson ?? {}),
        [input.summaryKey]: { code: 'WORKER_FAILED', message },
        status: PortfolioImportSessionStatus.FAILED,
      };

      await em.persist(session).flush();
      return true;
    }, { clear: true });
  }

  async updateSessionStatus(input: UpdatePortfolioImportSessionStatusInput): Promise<PortfolioImportSession> {
    const session = await this.getOwnedSession(input);
    session.status = input.status;
    if (input.summaryJson !== undefined) session.summaryJson = input.summaryJson;
    await DI.em.persist(session).flush();
    return session;
  }
}

export default new PortfolioImportSessionService();
