
import { sql } from 'kysely';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import { sqlQuery } from '@app/database/sql';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import type { Enqueue } from '@service/queue/enqueue';
import s3Service from '@service/storage/s3';

import historicalAssetPriceBackfillClient from './historical-asset-price-backfill-client';
import portfolioSnapshotService from './portfolio-snapshot.service';

interface BuyAssetRow {
  earliest_buy_date: Date | string;
  financial_asset_key: number | string;
  symbol: string;
}

interface ImportMaintenanceDeps {
  em?: typeof DI.em;
  historicalAssetPriceBackfillClient?: typeof historicalAssetPriceBackfillClient;
  portfolioSnapshotService?: typeof portfolioSnapshotService;
  s3Service?: typeof s3Service;
}

interface ImportMaintenanceInput {
  earliestTransactionDate?: Date;
  portfolioId: number;
}

interface StaleSessionLike {
  createdAt?: Date;
  deletedAt?: Date | null;
  expiredAt?: Date;
  expiresAt?: Date | null;
  portfolioImportSessionKey: number;
  s3Bucket: string;
  s3Key: string;
  status: PortfolioImportSessionStatus;
}

class PortfolioImportMaintenanceService {
  async expireStaleSessions(deps: ImportMaintenanceDeps = {}): Promise<number> {
    const em = deps.em ?? DI.em;
    const storage = deps.s3Service ?? s3Service;
    const now = new Date();
    const stale = await em.find(PortfolioImportSession, {
      $or: [
        { expiresAt: { $lte: now } },
        { createdAt: { $lte: new Date(now.getTime() - PORTFOLIO_IMPORT_SESSION_TTL_MS) }, expiresAt: null },
      ],
      deletedAt: undefined,
      status: { $nin: [PortfolioImportSessionStatus.CANCELLED, PortfolioImportSessionStatus.EXPIRED, PortfolioImportSessionStatus.FAILED, PortfolioImportSessionStatus.SUCCEEDED] },
    });
    const staleObjects = stale as StaleSessionLike[];
    for (const session of staleObjects) {
      session.status = PortfolioImportSessionStatus.EXPIRED;
      session.expiredAt = now;
    }
    if (staleObjects.length > 0) await em.persist(staleObjects).flush();
    for (const session of staleObjects) await storage.deleteObject(session.s3Bucket, session.s3Key).catch(() => undefined);
    return stale.length;
  }

  async triggerPostImportMaintenance(
    input: ImportMaintenanceInput,
    deps: ImportMaintenanceDeps & { enqueue: Enqueue },
  ): Promise<void> {
    const em = deps.em ?? DI.em;
    const backfillClient = deps.historicalAssetPriceBackfillClient ?? historicalAssetPriceBackfillClient;
    const snapshotService = deps.portfolioSnapshotService ?? portfolioSnapshotService;
    const buyAssets = await this.getPortfolioBuyAssets(input.portfolioId, em);

    if (buyAssets.length > 0) {
      await backfillClient.trigger({
        items: buyAssets.map((row) => ({
          earliestTransactionDate: toYmd(row.earliest_buy_date),
          financialAssetId: Number(row.financial_asset_key),
          symbol: row.symbol,
        })),
        portfolioId: input.portfolioId,
      }, { enqueue: deps.enqueue, throwOnFailure: true });
      return;
    }

    await snapshotService.backfillSnapshotsForPortfolio(input.portfolioId, input.earliestTransactionDate);
  }

  private async getPortfolioBuyAssets(portfolioId: number, em: typeof DI.em): Promise<BuyAssetRow[]> {
    const { rows } = await sql<BuyAssetRow>`
        SELECT
          ft.financial_asset_key,
          fa.symbol,
          MIN(ft.transaction_date) AS earliest_buy_date
        FROM financial_transaction ft
        INNER JOIN financial_asset fa ON fa.financial_asset_key = ft.financial_asset_key
        WHERE ft.portfolio_key = ${portfolioId}
          AND ft.deleted_at IS NULL
          AND ft.financial_transaction_type_key = ${FINANCIAL_TRANSACTION_TYPES.BUY}
        GROUP BY ft.financial_asset_key, fa.symbol
        ORDER BY ft.financial_asset_key
      `.execute(sqlQuery(em));
    return rows;
  }
}

const PORTFOLIO_IMPORT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toYmd(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

export default new PortfolioImportMaintenanceService();
