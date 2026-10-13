import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { getBackgroundOperationRetrySpec } from '@service/operations/background-operation-retry-registry';
import backgroundOperationService from '@service/operations/background-operation.service';
import { getBackgroundOperationRequestSchema, listAdminBackgroundOperationsRequestSchema, retryAdminBackgroundOperationRequestSchema } from '@validators/background-operation';

interface AdminBackgroundOperation { appuserKey?: null | number | { appuserKey: number }; attemptCount: number; backgroundOperationKey: number; correlationId: string; errorCode?: string; finishedAt?: Date; lastHeartbeatAt?: Date; operationType: string; pgBossDashboard?: never; progress?: null | Record<string, unknown>; queuedAt?: Date; queueJobId?: null | string; queueProvider: string; resourceId: string; retryable: boolean; stage?: string; startedAt?: Date; status: string; tenantKey?: null | number | { tenantKey: number }; updatedAt: Date }

// Mount path of the embedded bossbench pg-boss dashboard (see routes/v1/admin.ts). Same
// origin as this API, so links are relative rather than driven by an env var.
export const PGBOSS_DASHBOARD_BASE_PATH = '/v1/admin/jobs';

const pgBossJobUrl = (queueJobId?: null | string) => {
  if (!queueJobId) return null;
  return `${PGBOSS_DASHBOARD_BASE_PATH}/jobs/${encodeURIComponent(queueJobId)}`;
};

const toAdminDto = (operation: AdminBackgroundOperation) => ({
  appuserKey: typeof operation.appuserKey === 'number' ? operation.appuserKey : operation.appuserKey?.appuserKey ?? null,
  attemptCount: operation.attemptCount,
  correlationId: operation.correlationId,
  errorCode: operation.errorCode ?? null,
  finishedAt: operation.finishedAt ?? null,
  lastHeartbeatAt: operation.lastHeartbeatAt ?? null,
  operationKey: operation.backgroundOperationKey,
  operationType: operation.operationType,
  pgBossDashboard: PGBOSS_DASHBOARD_BASE_PATH,
  pgBossJob: pgBossJobUrl(operation.queueJobId),
  progress: operation.progress ?? null,
  publicOperation: `/v1/operations/${operation.correlationId}`,
  queuedAt: operation.queuedAt ?? null,
  queueJobId: operation.queueJobId ?? null,
  queueProvider: operation.queueProvider,
  resourceId: operation.resourceId,
  retryable: operation.retryable,
  retrySupported: Boolean(getBackgroundOperationRetrySpec(operation.operationType)),
  stage: operation.stage ?? null,
  startedAt: operation.startedAt ?? null,
  status: operation.status,
  tenantKey: typeof operation.tenantKey === 'number' ? operation.tenantKey : operation.tenantKey?.tenantKey ?? null,
  updatedAt: operation.updatedAt,
});

export async function getAdminBackgroundOperation(req: Request, res: Response) {
  const { params: { operationId } } = await zParse(getBackgroundOperationRequestSchema, req);
  const operation = await backgroundOperationService.getAdminOperation(operationId);
  return res.json(toAdminDto(operation));
}

export async function getAdminBackgroundOperationSummary(req: Request, res: Response) {
  const { query } = await zParse(listAdminBackgroundOperationsRequestSchema, req);
  const summary = await backgroundOperationService.getAdminSummary(query);
  return res.json(summary);
}

export async function listAdminBackgroundOperations(req: Request, res: Response) {
  const { query } = await zParse(listAdminBackgroundOperationsRequestSchema, req);
  const operations = await backgroundOperationService.listAdminOperations(query);
  return res.json(operations.map(toAdminDto));
}

export async function retryAdminBackgroundOperation(req: Request, res: Response) {
  const { body: { reason }, params: { operationId } } = await zParse(retryAdminBackgroundOperationRequestSchema, req);
  const result = await backgroundOperationService.retryAdminOperation(operationId, reason);
  return res.json({ ...toAdminDto(result.operation), queueJobId: result.jobId });
}
