import type { Request, Response } from 'express';

import { authedContext } from '@middleware/authed-context';
import { getTransactionReimbursements as getTransactionReimbursementsService, linkReimbursement as linkReimbursementService, suggestReimbursementCounterparts, unlinkReimbursement as unlinkReimbursementService } from '@service/transaction/transaction-reimbursement.service';
import { zParse } from '@validators/parser';
import { getReimbursementSuggestionsRequestSchema, getTransactionReimbursementsRequestSchema, linkReimbursementRequestSchema, unlinkReimbursementRequestSchema } from '@validators/transaction-reimbursement';

import { DI } from '../app';

/** `GET /v1/account/transaction/:transactionId/reimbursements`: the links on a transaction and what is left to link. */
export async function getTransactionReimbursements(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { params: { transactionId } } = await zParse(getTransactionReimbursementsRequestSchema, req);
  return res.json(await getTransactionReimbursementsService(DI.em, { appuserKey, tenantKey }, transactionId));
}

/** `GET /v1/account/transaction/:transactionId/reimbursements/suggestions`: what the other side could be. */
export async function getReimbursementSuggestions(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { params: { transactionId }, query: { limit, search } } = await zParse(getReimbursementSuggestionsRequestSchema, req);
  const suggestions = await suggestReimbursementCounterparts(DI.em, { appuserKey, tenantKey }, transactionId, { limit, search });
  return res.json({ suggestions });
}

/** `POST /v1/account/transaction/:transactionId/reimbursements`: link this incoming transaction to an expense. */
export async function linkReimbursement(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body: { amount, expenseTransactionId }, params: { transactionId } } = await zParse(linkReimbursementRequestSchema, req);
  const link = await linkReimbursementService(DI.em, { appuserKey, householdRole: req.householdRole, tenantKey }, transactionId, { amount, expenseTransactionKey: expenseTransactionId });
  return res.status(201).json({ link });
}

/** `DELETE /v1/account/transaction/:transactionId/reimbursements/:reimbursementId`: remove a link from either side. */
export async function unlinkReimbursement(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { params: { reimbursementId, transactionId } } = await zParse(unlinkReimbursementRequestSchema, req);
  await unlinkReimbursementService(DI.em, { appuserKey, householdRole: req.householdRole, tenantKey }, transactionId, reimbursementId);
  return res.json({ transactionReimbursementKey: reimbursementId });
}
