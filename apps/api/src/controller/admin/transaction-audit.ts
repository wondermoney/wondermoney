import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import type { TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { listDedupSkippedAuditRequestSchema, listRemediationAuditRequestSchema } from '@validators/transaction-audit';

import { DI } from '../../app.js';

/**
 * Flattens an audit row to the FK ids only — the relations are never populated on these reads, so
 * we read each reference's primary key directly (same approach as the background-operation DTO).
 */
const toAuditDto = (row: TransactionAuditLog) => ({
  accountKey: row.accountKey?.accountKey ?? null,
  actorAppuserKey: row.actorAppuserKey?.appuserKey ?? null,
  actorType: row.actorType,
  appuserKey: row.appuserKey.appuserKey,
  changes: row.changes ?? null,
  createdAt: row.createdAt,
  eventType: row.eventType,
  source: row.source ?? null,
  tenantKey: row.tenantKey.tenantKey,
  transactionAuditLogKey: row.transactionAuditLogKey,
  transactionKey: row.transactionKey.transactionKey,
});

export async function listDedupSkippedAudit(req: Request, res: Response): Promise<Response> {
  const { query } = await zParse(listDedupSkippedAuditRequestSchema, req);
  const rows = await TransactionAuditService.listDedupSkipped(DI.em, query);
  return res.json(rows.map(toAuditDto));
}

export async function listRemediationAudit(req: Request, res: Response): Promise<Response> {
  const { query } = await zParse(listRemediationAuditRequestSchema, req);
  const rows = await TransactionAuditService.listRemediations(DI.em, query);
  return res.json(rows.map(toAuditDto));
}
