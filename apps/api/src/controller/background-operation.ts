import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { authedUser } from '@middleware/authed-context';
import backgroundOperationService from '@service/operations/background-operation.service';
import { getBackgroundOperationRequestSchema } from '@validators/background-operation';

export async function getBackgroundOperation(req: Request, res: Response) {
  const user = authedUser(req);
  const { params: { operationId } } = await zParse(getBackgroundOperationRequestSchema, req);
  const operation = await backgroundOperationService.getVisibleOperationForUser(user, operationId);
  return res.json({
    errorCode: operation.errorCode,
    finishedAt: operation.finishedAt,
    lastHeartbeatAt: operation.lastHeartbeatAt,
    operationId: operation.correlationId,
    progress: operation.progress,
    queuedAt: operation.queuedAt,
    resourceId: operation.resourceId,
    retryable: operation.retryable,
    stage: operation.stage,
    startedAt: operation.startedAt,
    status: operation.status,
    type: operation.operationType,
  });
}
