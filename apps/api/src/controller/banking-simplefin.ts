import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { connectSimplefinRequestSchema, simplefinConnectionRequestSchema } from '@app/validators/banking';
import { zParse } from '@app/validators/parser';
import type { Tenant } from '@entity/Tenant';
import { authedUser } from '@middleware/authed-context';
import accountInitialSyncEnqueueService from '@service/account/account-initial-sync-enqueue.service';
import { BankSyncHistoryService } from '@service/bank-sync/bank-sync-history.service';
import { connectSimplefin, disconnectSimplefin } from '@service/simplefin/simplefin-connection.service';
import { InternalServerError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * SimpleFIN's own routes, under `/v1/banking/simplefin`. Its connections are a separate id space
 * from Enable Banking's (`connectionId` in `GET /v1/banking/connections`, told apart by
 * `provider: 'SimpleFIN'`), so history and disconnect have their own paths.
 *
 * Neither the setup token nor the access URL it is exchanged for ever appears in a response, a
 * log line or an error message.
 */

/**
 * `POST /v1/banking/simplefin/connections` with `{ setupToken }`. Claims the token, stores the
 * access URL encrypted and starts the first sync. 201 with the new connection's id and, when the
 * first sync was queued, the incident id `GET /v1/banking/sync/:incidentId/status` takes.
 */
export async function connectSimplefinBank(req: Request, res: Response) {
  const user = authedUser(req);
  const tenant = requireTenant(req);
  const { body: { setupToken } } = await zParse(connectSimplefinRequestSchema, req);

  const { bankConnection, connection } = await connectSimplefin(DI.em, { appuser: user, setupToken, tenant });

  // The connection exists either way; a failed enqueue leaves it to the scheduler's next pass.
  let incidentId: null | string = null;
  try {
    ({ incidentId } = await accountInitialSyncEnqueueService.enqueue(bankConnection, { enqueue: req.enqueue }));
  } catch (error) {
    logger.warn({ bankConnectionKey: bankConnection.bankConnectionKey, error: error instanceof Error ? error.name : 'unknown' }, 'SimpleFIN connected, but the first sync could not be queued');
  }

  return res.status(201).json({ connectionId: connection.simplefinConnectionKey, incidentId });
}

/** `DELETE /v1/banking/simplefin/connections/:connectionId`: stops syncing and destroys the stored access. */
export async function disconnectSimplefinBank(req: Request, res: Response) {
  const user = authedUser(req);
  const tenant = requireTenant(req);
  const { params: { connectionId } } = await zParse(simplefinConnectionRequestSchema, req);
  await disconnectSimplefin(DI.em, connectionId, user, tenant);
  return res.sendStatus(200);
}

/** `GET /v1/banking/simplefin/connections/:connectionId/syncs`: the last 20 runs, owner-only. */
export async function getSimplefinConnectionSyncs(req: Request, res: Response) {
  const user = authedUser(req);
  const tenant = requireTenant(req);
  const { params: { connectionId } } = await zParse(simplefinConnectionRequestSchema, req);
  const syncs = await new BankSyncHistoryService(DI.em).getSimplefinConnectionHistory(connectionId, user, tenant);
  return res.json({ syncs });
}

function requireTenant(req: Request): Tenant {
  if (!req.tenant || !Number.isInteger(req.tenant.tenantKey) || req.tenant.tenantKey <= 0) {
    throw new InternalServerError('Authenticated tenant is required for a SimpleFIN connection');
  }
  return req.tenant;
}
