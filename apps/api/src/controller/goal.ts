import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { GoalType } from '@entity/Goal';
import { GoalService } from '@service/goal/goal.service';
import { getRef } from '@utils/em-helpers';
import { BadRequestError } from '@utils/errors';
import {
  assignGoalMoneyRequestSchema,
  createGoalRequestSchema,
  fundGoalTransactionRequestSchema,
  goalAccountLinkRequestSchema,
  goalActivityQueryRequestSchema,
  goalParamsRequestSchema,
  listGoalsRequestSchema,
  moveGoalMoneyOutRequestSchema,
  undoGoalTransactionFundingRequestSchema,
  unlinkGoalAccountRequestSchema,
  updateGoalRequestSchema,
} from '@validators/goal';
import { zParse } from '@validators/parser';

type GoalRequest = Request & { user: { appuserKey: number; currencyKey: { currencyKey: number } } };

export async function archiveGoal(req: Request, res: Response) {
  const { params } = await zParse(goalParamsRequestSchema, req);
  const goal = await getGoalService().archiveGoal({ ...(await getGoalContext(req)), goalKey: params.goalKey });
  return res.json({ goal });
}

export const deleteGoal = archiveGoal;

export async function assignGoalMoney(req: Request, res: Response) {
  const { body, params } = await zParse(assignGoalMoneyRequestSchema, req);
  const result = await getGoalService().assignMoneyToGoal({ ...(await getGoalContext(req)), amount: body.amount, currencyKey: getUserCurrencyKey(req), goalKey: params.goalKey });
  return res.json(result);
}

export async function createGoal(req: Request, res: Response) {
  const { body } = await zParse(createGoalRequestSchema, req);
  const { user } = req as GoalRequest;
  const { tenantKey } = await getGoalContext(req);
  const isDebt = body.type === 'debt_paydown';
  // For debt goals the "target" is the balance to eliminate; default it from the current balance.
  const targetAmount = body.targetAmount ?? (isDebt ? body.currentBalance : undefined);
  const goal = await getGoalService().createGoal({
    annualInterestRateBps: percentToBps(body.annualInterestRatePercent),
    appuserKey: user.appuserKey,
    currencyKey: body.currencyId ? enforceUserCurrency(body.currencyId, user) : user.currencyKey.currencyKey,
    currentBalance: body.currentBalance,
    description: body.description,
    extraPayment: body.extraPayment,
    loanKey: body.loanKey ?? undefined,
    minimumPayment: body.minimumPayment,
    monthlyContributionTarget: body.monthlyContributionTarget,
    name: body.name,
    priority: body.priority,
    targetAmount: targetAmount!,
    targetDate: body.targetDate ?? undefined,
    tenantKey,
    type: isDebt ? GoalType.DEBT_PAYDOWN : GoalType.SAVE_UP,
  });
  return res.status(201).json({ goal });
}

export async function fundGoalTransaction(req: Request, res: Response) {
  const { body, params } = await zParse(fundGoalTransactionRequestSchema, req);
  const funding = await getGoalService().fundTransactionFromGoal({ ...(await getGoalContext(req)), amount: body.amount, goalKey: params.goalKey, transactionKey: body.transactionKey });
  return res.json({ funding });
}

export async function getAvailableToAssign(req: Request, res: Response) {
  const availableToAssign = await getGoalService().getAvailableToAssign(await getGoalContext(req));
  return res.json({ availableToAssign });
}

export async function getGoal(req: Request, res: Response) {
  const { params } = await zParse(goalParamsRequestSchema, req);
  const result = await getGoalService().getGoal({ ...(await getGoalContext(req)), goalKey: params.goalKey });
  return res.json(result);
}

export async function getGoalActivity(req: Request, res: Response) {
  const { params, query } = await zParse(goalActivityQueryRequestSchema, req);
  const result = await getGoalService().getGoalActivity({ ...(await getGoalContext(req)), goalKey: params.goalKey, limit: query.limit, offset: query.offset });
  return res.json(result);
}

export async function getGoalDebtStrategy(req: Request, res: Response) {
  const strategy = await getGoalService().getDebtStrategy(await getGoalContext(req));
  return res.json(strategy);
}

export async function linkGoalAccount(req: Request, res: Response) {
  const { body, params } = await zParse(goalAccountLinkRequestSchema, req);
  const link = await getGoalService().linkGoalAccount({ ...(await getGoalContext(req)), accountKey: body.accountKey, goalKey: params.goalKey });
  return res.status(201).json({ link });
}

export async function listGoals(req: Request, res: Response) {
  const { query } = await zParse(listGoalsRequestSchema, req);
  const goals = await getGoalService().listGoals({ ...(await getGoalContext(req)), includeArchived: query.includeArchived });
  return res.json({ goals });
}

export async function moveGoalMoneyOut(req: Request, res: Response) {
  const { body, params } = await zParse(moveGoalMoneyOutRequestSchema, req);
  const result = await getGoalService().moveMoneyOutOfGoal({ ...(await getGoalContext(req)), amount: body.amount, currencyKey: getUserCurrencyKey(req), goalKey: params.goalKey });
  return res.json(result);
}

export async function restoreGoal(req: Request, res: Response) {
  const { params } = await zParse(goalParamsRequestSchema, req);
  const goal = await getGoalService().restoreGoal({ ...(await getGoalContext(req)), goalKey: params.goalKey });
  return res.json({ goal });
}

export async function undoGoalTransactionFunding(req: Request, res: Response) {
  const { params } = await zParse(undoGoalTransactionFundingRequestSchema, req);
  const funding = await getGoalService().undoTransactionFunding({ ...(await getGoalContext(req)), goalKey: params.goalKey, goalTransactionFundingKey: params.fundingKey });
  return res.json({ funding });
}

export const deleteGoalTransactionFunding = undoGoalTransactionFunding;

export async function unlinkGoalAccount(req: Request, res: Response) {
  const { params } = await zParse(unlinkGoalAccountRequestSchema, req);
  await getGoalService().unlinkGoalAccount({ ...(await getGoalContext(req)), accountKey: params.accountKey, goalKey: params.goalKey });
  return res.sendStatus(204);
}

export const deleteGoalAccount = unlinkGoalAccount;

export async function updateGoal(req: Request, res: Response) {
  const { body, params } = await zParse(updateGoalRequestSchema, req);
  const { user } = req as GoalRequest;
  const goal = await getGoalService().updateGoal({
    ...(await getGoalContext(req)),
    annualInterestRateBps: body.annualInterestRatePercent !== undefined ? percentToBps(body.annualInterestRatePercent) : undefined,
    currencyKey: body.currencyId !== undefined ? enforceUserCurrency(body.currencyId, user) : undefined,
    currentBalance: body.currentBalance,
    description: body.description,
    extraPayment: body.extraPayment,
    goalKey: params.goalKey,
    loanKey: body.loanKey,
    minimumPayment: body.minimumPayment,
    monthlyContributionTarget: body.monthlyContributionTarget,
    name: body.name,
    priority: body.priority,
    targetAmount: body.targetAmount,
    targetDate: body.targetDate ?? undefined,
    type: body.type !== undefined ? (body.type === 'debt_paydown' ? GoalType.DEBT_PAYDOWN : GoalType.SAVE_UP) : undefined,
  });
  return res.json({ goal });
}

function enforceUserCurrency(currencyId: number, user: GoalRequest['user']) {
  if (currencyId !== user.currencyKey.currencyKey) throw new BadRequestError('Goals must use the user currency');
  return currencyId;
}

async function getGoalContext(req: Request) {
  const { user } = req as GoalRequest;
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(getRef(DI.em, Appuser, user.appuserKey));
  if (!appuserTenant) throw new Error('Appuser tenant not found');
  return { appuserKey: user.appuserKey, tenantKey: appuserTenant.tenantKey.tenantKey };
}

function getGoalService() {
  return new GoalService(DI.em);
}

function getUserCurrencyKey(req: Request) {
  return (req as GoalRequest).user.currencyKey.currencyKey;
}

function percentToBps(percent?: number): number | undefined {
  return percent === undefined ? undefined : Math.round(percent * 100);
}
