import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { authedUser } from '@middleware/authed-context';
import { loadConnectionHealth } from '@service/bank-sync-alerts/bank-sync-alert-health.repository';
import { toInAppBankSyncAlerts } from '@service/bank-sync-alerts/bank-sync-alert-in-app';
import { InternalServerError } from '@utils/errors';

/**
 * The viewer's bank connections that need them (consent ending, ended by the bank, syncs failing),
 * for the home banner. Only connections the viewer owns in their household: a partner's
 * connection, and so their private accounts, never show. Empty list is a 200.
 */
export async function getBankingAlerts(req: Request, res: Response) {
  const user = authedUser(req);
  const tenantKey = req.tenant?.tenantKey;
  if (!tenantKey || !Number.isInteger(tenantKey) || tenantKey <= 0) {
    throw new InternalServerError('Authenticated tenant is required to read bank alerts');
  }
  const connections = await loadConnectionHealth(DI.em, { appuserKey: user.appuserKey, scope: 'viewer', tenantKey });
  return res.json({ alerts: toInAppBankSyncAlerts(connections, new Date()) });
}
