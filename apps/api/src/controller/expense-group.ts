import type { Request, Response } from 'express';

import { authedContext } from '@middleware/authed-context';
import * as service from '@service/expense-group/expense-group.service';
import {
  addExpenseGroupMemberRequestSchema,
  createExpenseGroupRequestSchema,
  expenseGroupMemberRequestSchema,
  expenseGroupRequestSchema,
  groupExpenseRequestSchema,
  groupSettlementRequestSchema,
  recordSettlementRequestSchema,
  settlementSuggestionsRequestSchema,
  shareExpenseRequestSchema,
  updateExpenseGroupMemberRequestSchema,
  updateExpenseGroupRequestSchema,
} from '@validators/expense-group';
import { zParse } from '@validators/parser';

import { DI } from '../app';

/** The member asking, with their household role: a viewer reads only (`account-access.ts`). */
const actorOf = (req: Request) => {
  const { appuserKey, tenantKey } = authedContext(req);
  return { appuserKey, householdRole: req.householdRole, tenantKey };
};

/** `GET /v1/expense-groups`: the household's groups, with the viewer's balances. */
export async function listExpenseGroups(req: Request, res: Response) {
  return res.json({ groups: await service.listExpenseGroups(DI.em, actorOf(req)) });
}

/** `POST /v1/expense-groups`. */
export async function createExpenseGroup(req: Request, res: Response) {
  const { body } = await zParse(createExpenseGroupRequestSchema, req);
  const group = await service.createExpenseGroup(DI.em, actorOf(req), {
    currencyCode: body.currencyCode,
    members: body.members.map((member) => ({ appuserKey: member.householdMemberId ?? null, email: member.email, name: member.name })),
    name: body.name,
  });
  return res.status(201).json({ group });
}

/** `GET /v1/expense-groups/:groupId`. */
export async function getExpenseGroup(req: Request, res: Response) {
  const { params } = await zParse(expenseGroupRequestSchema, req);
  return res.json({ group: await service.getExpenseGroup(DI.em, actorOf(req), params.groupId) });
}

/** `PATCH /v1/expense-groups/:groupId`: rename, change the default currency, archive. */
export async function updateExpenseGroup(req: Request, res: Response) {
  const { body, params } = await zParse(updateExpenseGroupRequestSchema, req);
  return res.json({ group: await service.updateExpenseGroup(DI.em, actorOf(req), params.groupId, body) });
}

/** `DELETE /v1/expense-groups/:groupId`: only an empty group. */
export async function deleteExpenseGroup(req: Request, res: Response) {
  const { params } = await zParse(expenseGroupRequestSchema, req);
  await service.deleteExpenseGroup(DI.em, actorOf(req), params.groupId);
  return res.json({ expenseGroupKey: params.groupId });
}

/** `POST /v1/expense-groups/:groupId/members`. */
export async function addExpenseGroupMember(req: Request, res: Response) {
  const { body, params } = await zParse(addExpenseGroupMemberRequestSchema, req);
  const member = await service.addExpenseGroupMember(DI.em, actorOf(req), params.groupId, { appuserKey: body.householdMemberId ?? null, email: body.email, name: body.name });
  return res.status(201).json({ member });
}

/** `PATCH /v1/expense-groups/:groupId/members/:memberId`. */
export async function updateExpenseGroupMember(req: Request, res: Response) {
  const { body, params } = await zParse(updateExpenseGroupMemberRequestSchema, req);
  return res.json({ member: await service.updateExpenseGroupMember(DI.em, actorOf(req), params.groupId, params.memberId, body) });
}

/** `DELETE /v1/expense-groups/:groupId/members/:memberId`: only someone with nothing in the group. */
export async function removeExpenseGroupMember(req: Request, res: Response) {
  const { params } = await zParse(expenseGroupMemberRequestSchema, req);
  await service.removeExpenseGroupMember(DI.em, actorOf(req), params.groupId, params.memberId);
  return res.json({ expenseGroupMemberKey: params.memberId });
}

/** `GET /v1/expense-groups/:groupId/shares`: the shared expenses the viewer may see. */
export async function listGroupExpenses(req: Request, res: Response) {
  const { params } = await zParse(expenseGroupRequestSchema, req);
  return res.json({ expenses: await service.listGroupExpenses(DI.em, actorOf(req), params.groupId) });
}

/** `POST /v1/expense-groups/:groupId/shares`: share a transaction, or change its shares. */
export async function shareGroupExpense(req: Request, res: Response) {
  const { body, params } = await zParse(shareExpenseRequestSchema, req);
  const expense = await service.shareGroupExpense(DI.em, actorOf(req), params.groupId, {
    categoryKey: body.categoryId,
    method: body.method,
    paidByMemberKey: body.paidByMemberId,
    shares: body.shares.map((share) => ({ amount: share.amount, memberKey: share.memberId, percentage: share.percentage })),
    transactionKey: body.transactionId,
  });
  return res.status(201).json({ expense });
}

/** `GET /v1/expense-groups/:groupId/shares/:transactionId`. */
export async function getGroupExpense(req: Request, res: Response) {
  const { params } = await zParse(groupExpenseRequestSchema, req);
  return res.json({ expense: await service.getGroupExpense(DI.em, actorOf(req), params.groupId, params.transactionId) });
}

/** `DELETE /v1/expense-groups/:groupId/shares/:transactionId`: stop sharing; the transaction is whole again. */
export async function unshareGroupExpense(req: Request, res: Response) {
  const { params } = await zParse(groupExpenseRequestSchema, req);
  await service.unshareGroupExpense(DI.em, actorOf(req), params.groupId, params.transactionId);
  return res.json({ transactionKey: params.transactionId });
}

/** `GET /v1/expense-groups/:groupId/balances`: who owes whom, per currency, with suggested payments. */
export async function getGroupBalances(req: Request, res: Response) {
  const { params } = await zParse(expenseGroupRequestSchema, req);
  return res.json(await service.getGroupBalances(DI.em, actorOf(req), params.groupId));
}

/** `GET /v1/expense-groups/:groupId/settlements`. */
export async function listGroupSettlements(req: Request, res: Response) {
  const { params } = await zParse(expenseGroupRequestSchema, req);
  return res.json({ settlements: await service.listGroupSettlements(DI.em, actorOf(req), params.groupId) });
}

/** `GET /v1/expense-groups/:groupId/settlements/suggestions`. */
export async function getSettlementSuggestions(req: Request, res: Response) {
  const { params, query } = await zParse(settlementSuggestionsRequestSchema, req);
  const suggestions = await service.suggestSettlementTransactions(DI.em, actorOf(req), params.groupId, {
    currencyCode: query.currencyCode,
    fromMemberKey: query.fromMemberId,
    limit: query.limit,
    search: query.search,
    toMemberKey: query.toMemberId,
  });
  return res.json({ suggestions });
}

/** `POST /v1/expense-groups/:groupId/settlements`. */
export async function recordGroupSettlement(req: Request, res: Response) {
  const { body, params } = await zParse(recordSettlementRequestSchema, req);
  const settlement = await service.recordGroupSettlement(DI.em, actorOf(req), params.groupId, {
    amount: body.amount,
    currencyCode: body.currencyCode,
    fromMemberKey: body.fromMemberId,
    notes: body.notes,
    settledOn: body.settledOn,
    toMemberKey: body.toMemberId,
    transactionKey: body.transactionId ?? null,
  });
  return res.status(201).json({ settlement });
}

/** `DELETE /v1/expense-groups/:groupId/settlements/:settlementId`. */
export async function deleteGroupSettlement(req: Request, res: Response) {
  const { params } = await zParse(groupSettlementRequestSchema, req);
  await service.deleteGroupSettlement(DI.em, actorOf(req), params.groupId, params.settlementId);
  return res.json({ expenseGroupSettlementKey: params.settlementId });
}
