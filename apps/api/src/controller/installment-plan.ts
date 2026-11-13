import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { authedContext } from '@middleware/authed-context';
import { accountActor, assertAccountWritable, assertTransactionWritable } from '@service/account/account-access';
import {
  createInstallmentPlan,
  deleteInstallmentPlan,
  describePlan,
  describePlans,
  findPlanOrFail,
  linkInstallment,
  listCommitments,
  listPlans,
  listSuggestions,
  summarizePlan,
  unlinkInstallment,
  updateInstallmentPlan,
} from '@service/installment/installment-plan.service';
import {
  createInstallmentPlanRequestSchema,
  deleteInstallmentPlanRequestSchema,
  getInstallmentPlanRequestSchema,
  linkInstallmentRequestSchema,
  listInstallmentCommitmentsRequestSchema,
  listInstallmentPlansRequestSchema,
  listInstallmentSuggestionsRequestSchema,
  unlinkInstallmentRequestSchema,
  updateInstallmentPlanRequestSchema,
} from '@validators/installment-plan';
import { zParse } from '@validators/parser';

/*
 * `/v1/installment-plans`: card purchases split into monthly installments. Future installments are
 * projections (schedule rows), never transactions; see `services/installment/installment-plan.service.ts`.
 * Every lookup runs through the request's tenant filter, so a plan on another household's card, or
 * on the other member's private card, is a 404.
 */

/** `GET /v1/installment-plans?accountId=`: the caller's plans, newest purchase first. */
export async function getInstallmentPlans(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const { query } = await zParse(listInstallmentPlansRequestSchema, req);
  const plans = await listPlans(DI.em, { accountKey: query.accountId, tenantKey });
  const described = await describePlans(DI.em, plans, new Date());
  return res.json({ installmentPlans: described.map(summarizePlan) });
}

/** `GET /v1/installment-plans/commitments?accountId=`: the upcoming installments still to come, per card. */
export async function getInstallmentCommitments(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const { query } = await zParse(listInstallmentCommitmentsRequestSchema, req);
  const commitments = await listCommitments(DI.em, { accountKey: query.accountId, tenantKey, today: new Date() });
  return res.json({ commitments });
}

/** `GET /v1/installment-plans/suggestions?accountId=`: posted rows that look like one purchase's installments. */
export async function getInstallmentSuggestions(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const { query } = await zParse(listInstallmentSuggestionsRequestSchema, req);
  const suggestions = await listSuggestions(DI.em, { accountKey: query.accountId, tenantKey, today: new Date() });
  return res.json({ suggestions });
}

/** `GET /v1/installment-plans/:installmentPlanId`: one plan with its paid and upcoming installments. */
export async function getInstallmentPlan(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const { params } = await zParse(getInstallmentPlanRequestSchema, req);
  const plan = await findPlanOrFail(DI.em, params.installmentPlanId, tenantKey);
  return res.json({ installmentPlan: await describePlan(DI.em, plan, new Date()) });
}

/** `POST /v1/installment-plans`: create a plan by hand, or accept a suggestion by passing its links. */
export async function postInstallmentPlan(req: Request, res: Response) {
  const { tenant, tenantKey, user } = authedContext(req);
  const { body } = await zParse(createInstallmentPlanRequestSchema, req);
  // A plan belongs to its card: creating one changes that account's data.
  await assertAccountWritable(DI.em, body.accountKey, accountActor(req));
  const created = await createInstallmentPlan(DI.em, body, { tenant, tenantKey, user });
  const plan = await findPlanOrFail(DI.em, created.installmentPlanKey, tenantKey);
  return res.status(201).json({ installmentPlan: await describePlan(DI.em, plan, new Date()) });
}

/** `PATCH /v1/installment-plans/:installmentPlanId`: a new amount, count or date rewrites the schedule. */
export async function patchInstallmentPlan(req: Request, res: Response) {
  const { tenant, tenantKey, user } = authedContext(req);
  const { body, params } = await zParse(updateInstallmentPlanRequestSchema, req);
  const plan = await findPlanOrFail(DI.em, params.installmentPlanId, tenantKey);
  await assertAccountWritable(DI.em, plan.accountKey, accountActor(req));
  await updateInstallmentPlan(DI.em, plan, body, { tenant, tenantKey, user });
  return res.json({ installmentPlan: await describePlan(DI.em, plan, new Date()) });
}

/** `DELETE /v1/installment-plans/:installmentPlanId`: the posted transactions stay, unlinked. */
export async function removeInstallmentPlan(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const { params } = await zParse(deleteInstallmentPlanRequestSchema, req);
  const plan = await findPlanOrFail(DI.em, params.installmentPlanId, tenantKey);
  await assertAccountWritable(DI.em, plan.accountKey, accountActor(req));
  await deleteInstallmentPlan(DI.em, plan);
  return res.sendStatus(204);
}

/** `POST /v1/installment-plans/:installmentPlanId/installments/:installmentNumber/link`: mark an installment paid by a posted row. */
export async function postInstallmentLink(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const { body, params } = await zParse(linkInstallmentRequestSchema, req);
  const plan = await findPlanOrFail(DI.em, params.installmentPlanId, tenantKey);
  await assertAccountWritable(DI.em, plan.accountKey, accountActor(req));
  await assertTransactionWritable(DI.em, body.transactionKey, accountActor(req));
  await linkInstallment(DI.em, plan, params.installmentNumber, body.transactionKey);
  return res.json({ installmentPlan: await describePlan(DI.em, plan, new Date()) });
}

/** `DELETE /v1/installment-plans/:installmentPlanId/installments/:installmentNumber/link`: the installment is no longer paid. */
export async function deleteInstallmentLink(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const { params } = await zParse(unlinkInstallmentRequestSchema, req);
  const plan = await findPlanOrFail(DI.em, params.installmentPlanId, tenantKey);
  await assertAccountWritable(DI.em, plan.accountKey, accountActor(req));
  await unlinkInstallment(DI.em, plan, params.installmentNumber);
  return res.json({ installmentPlan: await describePlan(DI.em, plan, new Date()) });
}
