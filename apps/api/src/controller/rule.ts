import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authedContext } from '@middleware/authed-context';
import { previewRule as previewRuleService } from '@service/rules/rule-preview.service';
import { countRuleRun, type RuleRunScope, startRuleRun } from '@service/rules/rule-run.service';
import {
  createRule as createRuleService,
  deleteRule as deleteRuleService,
  listRules,
  reorderRules as reorderRulesService,
  updateRule as updateRuleService,
} from '@service/rules/rule.service';
import { zParse } from '@validators/parser';
import { applyAllRulesRequestSchema, applyRuleRequestSchema, createRuleRequestSchema, deleteRuleRequestSchema, previewRuleRequestSchema, reorderRulesRequestSchema, updateRuleRequestSchema } from '@validators/rule';

import { DI } from '../app';

export async function createRule(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body } = await zParse(createRuleRequestSchema, req);
  const rule = await createRuleService(DI.em, { appuserKey, tenantKey }, body);
  return res.status(StatusCodes.CREATED).json({ rule });
}

export async function deleteRule(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    params: { ruleId },
  } = await zParse(deleteRuleRequestSchema, req);
  await deleteRuleService(DI.em, { appuserKey, tenantKey }, ruleId);
  return res.sendStatus(StatusCodes.OK);
}

export async function getRules(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  return res.json({ rules: await listRules(DI.em, tenantKey) });
}

export async function updateRule(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body,
    params: { ruleId },
  } = await zParse(updateRuleRequestSchema, req);
  const rule = await updateRuleService(DI.em, { appuserKey, tenantKey }, ruleId, body);
  return res.json({ rule });
}

/** `PUT /v1/rule/order`: the household's full rule list in the new run order. */
export async function reorderRules(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body: { ruleIds },
  } = await zParse(reorderRulesRequestSchema, req);
  const rules = await reorderRulesService(DI.em, { appuserKey, tenantKey }, ruleIds);
  return res.json({ rules });
}

/**
 * `POST /v1/rule/preview`: what an unsaved rule would match and change among the household's
 * transactions the current member can see. Reads only.
 */
export async function previewRule(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body: { limit, ...draft },
  } = await zParse(previewRuleRequestSchema, req);
  return res.json(await previewRuleService(DI.em, { appuserKey, tenantKey }, draft, { limit }));
}

/**
 * `POST /v1/rule/:ruleId/apply`: apply one rule, judged on its own, to the household's existing
 * transactions. `{ dryRun: true }` answers `{ changeCount }`; `{ dryRun: false }` starts a
 * background run and answers 202 `{ operationId }` for `GET /v1/operations/:operationId`.
 */
export async function applyRule(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body: { dryRun },
    params: { ruleId },
  } = await zParse(applyRuleRequestSchema, req);
  return applyRules(req, res, { appuserKey, ruleKey: ruleId, tenantKey }, dryRun);
}

/** `POST /v1/rule/apply-all`: as `applyRule`, with every active rule in run order. */
export async function applyAllRules(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body: { dryRun },
  } = await zParse(applyAllRulesRequestSchema, req);
  return applyRules(req, res, { appuserKey, ruleKey: null, tenantKey }, dryRun);
}

async function applyRules(req: Request, res: Response, scope: RuleRunScope, dryRun: boolean) {
  if (dryRun) return res.json({ changeCount: await countRuleRun(DI.em, scope) });
  const { operationId } = await startRuleRun(DI.em, scope, { enqueue: req.enqueue });
  return res.status(StatusCodes.ACCEPTED).json({ operationId });
}
