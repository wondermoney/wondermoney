/**
 * Portfolio Import Session transitions.
 *
 * Owns the lock → status-check → previous-status capture → enqueue → compensating-rollback
 * flow for the two HTTP-triggered transitions (parse preview, confirm). The controller layer
 * is now a thin adapter: validate, delegate to `requestParse` / `requestConfirm`, return
 * 202. All rollback semantics — including the parse-specific jobId marker persistence and
 * the correlation-id-guarded restore — live here.
 *
 * Queue lifecycle belongs to request middleware; callers inject only the Enqueue capability.
 */
import { randomUUID } from 'node:crypto';

import { LockMode } from '@mikro-orm/core';

import { DI } from '@app/app';
import { enqueuePortfolioCsvImportConfirmedJob } from '@app/jobs/portfolio-csv-import-confirmed.queue';
import { enqueuePortfolioCsvParsePreviewJob } from '@app/jobs/portfolio-csv-parse-preview.queue';
import type { Appuser } from '@entity/Appuser';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { canConfirm } from '@service/portfolio/portfolio-import-session-state';
import portfolioImportSessionService from '@service/portfolio/portfolio-import-session.service';
import type { Enqueue } from '@service/queue/enqueue';
import s3Service from '@service/storage/s3';
import { ConflictError } from '@utils/errors';

export interface RequestTransitionInput {
  appuser: Appuser;
  importSessionId: number;
  tenant: { tenantKey: number };
}

export interface TransitionOutcome {
  correlationId: string;
  importSessionId: number;
  status: 'importing' | 'parsing';
}

const NOT_PARSABLE_FROM: readonly PortfolioImportSessionStatus[] = [
  PortfolioImportSessionStatus.CANCELLED,
  PortfolioImportSessionStatus.EXPIRED,
  PortfolioImportSessionStatus.FAILED,
  PortfolioImportSessionStatus.IMPORTING,
  PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW,
  PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING,
  PortfolioImportSessionStatus.READY_TO_IMPORT,
  PortfolioImportSessionStatus.SUCCEEDED,
];

const PARSEABLE_FROM: readonly PortfolioImportSessionStatus[] = [
  PortfolioImportSessionStatus.UPLOADED,
  PortfolioImportSessionStatus.WAITING_FOR_UPLOAD,
];

export class PortfolioImportSessionTransitions {
  /**
   * Drive the parse-preview transition: lock the session, check legal source state, take
   * an S3 existence precheck, set status to PARSING with the correlation id marker, enqueue,
   * then persist the returned jobId. On any failure between the lock release and the marker
   * write, restore the previous status + summaryJson (guarded by the correlation id).
   *
   * If the session is already PARSING with both correlation id and jobId markers, returns
   * the existing correlation id without enqueueing (idempotent re-entry).
   */
  public async requestParse(input: RequestTransitionInput, deps: { enqueue: Enqueue }): Promise<TransitionOutcome> {
    const correlationId = `portfolio.csv-parse-preview:${input.importSessionId}:${randomUUID().replaceAll('-', '')}`;
    let previousStatus: PortfolioImportSessionStatus | undefined;
    let previousSummaryJson: Record<string, unknown> | undefined;
    let existingParseCorrelationId: string | undefined;

    await DI.em.transactional(async (em) => {
      const lockedSession = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant }, { em, lockMode: LockMode.PESSIMISTIC_WRITE });
      if (portfolioImportSessionService.isExpired(lockedSession)) throw new ConflictError('Import session has expired');
      if (NOT_PARSABLE_FROM.includes(lockedSession.status)) {
        throw new ConflictError('Import session cannot be parsed');
      }
      if (lockedSession.status === PortfolioImportSessionStatus.PARSING) {
        const existingCorrelationId = getParseCorrelationId(lockedSession.summaryJson);
        const existingJobId = getParseJobId(lockedSession.summaryJson);
        if (existingCorrelationId && existingJobId) {
          existingParseCorrelationId = existingCorrelationId;
          return lockedSession;
        }
        throw new ConflictError('Import session parse is being queued');
      }
      if (!PARSEABLE_FROM.includes(lockedSession.status)) {
        throw new ConflictError('Import session cannot be parsed');
      }
      try {
        await s3Service.getObjectSize(lockedSession.s3Bucket, lockedSession.s3Key);
      } catch (error) {
        if (isMissingS3ObjectError(error)) {
          throw new ConflictError('Import session upload is not available yet');
        }
        throw error;
      }
      previousStatus = lockedSession.status;
      previousSummaryJson = lockedSession.summaryJson;
      lockedSession.status = PortfolioImportSessionStatus.PARSING;
      lockedSession.summaryJson = { ...(lockedSession.summaryJson ?? {}), parseCorrelationId: correlationId };
      await em.persist(lockedSession).flush();
      return lockedSession;
    });

    if (existingParseCorrelationId) {
      return { correlationId: existingParseCorrelationId, importSessionId: input.importSessionId, status: 'parsing' };
    }

    let jobAccepted = false;
    try {
      const jobId = await enqueuePortfolioCsvParsePreviewJob({ correlationId, importSessionId: input.importSessionId }, deps);
      if (jobId == null) {
        throw new ConflictError('Portfolio import session parse queue returned no job id');
      }
      jobAccepted = true;
      await DI.em.transactional(async (em) => {
        const lockedSession = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant }, { em, lockMode: LockMode.PESSIMISTIC_WRITE });
        if (lockedSession.status !== PortfolioImportSessionStatus.PARSING || getParseCorrelationId(lockedSession.summaryJson) !== correlationId) return;
        lockedSession.summaryJson = { ...(lockedSession.summaryJson ?? {}), parseCorrelationId: correlationId, parseJobId: String(jobId) };
        await em.persist(lockedSession).flush();
      });
    } catch (error) {
      if (!jobAccepted && previousStatus !== undefined) {
        await DI.em.transactional(async (em) => {
          const lockedSession = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant }, { em, lockMode: LockMode.PESSIMISTIC_WRITE });
          if (lockedSession.status !== PortfolioImportSessionStatus.PARSING || getParseCorrelationId(lockedSession.summaryJson) !== correlationId) return;
          const restoredStatus = previousStatus;
          if (restoredStatus === undefined) return;
          lockedSession.status = restoredStatus;
          lockedSession.summaryJson = previousSummaryJson;
          await em.persist(lockedSession).flush();
        });
      }
      throw error;
    }

    return { correlationId, importSessionId: input.importSessionId, status: 'parsing' };
  }

  /**
   * Drive the confirm transition: lock the session, check the `canConfirm` predicate, set
   * status to IMPORTING with the correlation id marker, enqueue. On failure, restore the
   * previous status + summaryJson (guarded by the correlation id).
   */
  public async requestConfirm(input: RequestTransitionInput, deps: { enqueue: Enqueue }): Promise<TransitionOutcome> {
    const correlationId = `portfolio.csv-import-confirmed:${input.importSessionId}:${randomUUID().replaceAll('-', '')}`;
    let previousStatus: PortfolioImportSessionStatus | undefined;
    let previousSummaryJson: Record<string, unknown> | undefined;

    let jobAccepted = false;
    try {
      await DI.em.transactional(async (em) => {
        const session = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant }, { em, lockMode: LockMode.PESSIMISTIC_WRITE });
        if (portfolioImportSessionService.isExpired(session)) throw new ConflictError('Import session has expired');
        if (!canConfirm(session)) {
          throw new ConflictError('Import session cannot be confirmed');
        }
        previousStatus = session.status;
        previousSummaryJson = session.summaryJson ?? undefined;
        session.status = PortfolioImportSessionStatus.IMPORTING;
        session.summaryJson = { ...(session.summaryJson ?? {}), confirmCorrelationId: correlationId };
        await em.persist(session).flush();
      });

      const jobId = await enqueuePortfolioCsvImportConfirmedJob({ correlationId, importSessionId: input.importSessionId }, deps);
      if (jobId == null) {
        throw new ConflictError('Portfolio import session confirm queue returned no job id');
      }
      jobAccepted = true;
    } catch (error) {
      if (jobAccepted) throw error;
      await DI.em.transactional(async (em) => {
        const session = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant }, { em, lockMode: LockMode.PESSIMISTIC_WRITE });
        if (session.status !== PortfolioImportSessionStatus.IMPORTING || session.summaryJson?.['confirmCorrelationId'] !== correlationId) return;
        if (previousStatus) session.status = previousStatus;
        session.summaryJson = previousSummaryJson;
        await em.persist(session).flush();
      });
      throw error;
    }

    return { correlationId, importSessionId: input.importSessionId, status: 'importing' };
  }
}

function getParseCorrelationId(summaryJson: Record<string, unknown> | undefined): string | undefined {
  const value = summaryJson?.['parseCorrelationId'];
  return typeof value === 'string' ? value : undefined;
}

function getParseJobId(summaryJson: Record<string, unknown> | undefined): string | undefined {
  const value = summaryJson?.['parseJobId'];
  return typeof value === 'string' ? value : undefined;
}

function isMissingS3ObjectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const metadata = '$metadata' in error ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata : undefined;
  return metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey' || error.name === 'NotFound';
}

export default new PortfolioImportSessionTransitions();
