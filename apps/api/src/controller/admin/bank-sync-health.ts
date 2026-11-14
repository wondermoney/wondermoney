import type { Request, Response } from 'express';

import { getBankSyncHealth, listFailingBankConnections } from '@service/bank-sync/bank-sync-health.service';

import { DI } from '../../app.js';

// Instance-wide bank sync health (cross-tenant aggregates, no personal data), for an instance
// admin session or the admin API key (`requireInstanceAdmin`).
export async function getAdminBankSyncHealth(_req: Request, res: Response): Promise<Response> {
  return res.json(await getBankSyncHealth(DI.em));
}

// Connections failing for longer than the threshold: institution, error code, last success.
export async function listAdminFailingBankConnections(_req: Request, res: Response): Promise<Response> {
  return res.json(await listFailingBankConnections(DI.em));
}
