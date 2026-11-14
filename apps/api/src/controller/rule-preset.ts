import type { Request, Response } from 'express';

import { authedContext } from '@middleware/authed-context';
import { installRulePreset as installRulePresetService, listRulePresets, previewRulePreset } from '@service/rules/rule-preset.service';
import { zParse } from '@validators/parser';
import { listRulePresetsRequestSchema, rulePresetParamsRequestSchema } from '@validators/rule-preset';

import { DI } from '../app';

/**
 * `GET /v1/rule/presets`: the locale rule presets, each with its rule count and how much of it
 * the household already has, and `suggested`, the one matching the person's language and country.
 */
export async function getRulePresets(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { query } = await zParse(listRulePresetsRequestSchema, req);
  return res.json(await listRulePresets(DI.em, { appuserKey, tenantKey }, query));
}

/** `GET /v1/rule/presets/:code`: every rule the preset holds and what installing would do with it. */
export async function getRulePreset(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    params: { code },
  } = await zParse(rulePresetParamsRequestSchema, req);
  return res.json(await previewRulePreset(DI.em, { appuserKey, tenantKey }, code));
}

/**
 * `POST /v1/rule/presets/:code/install`: append the preset's rules after the household's own,
 * skipping any it already has by name, so installing twice adds nothing.
 */
export async function installRulePreset(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    params: { code },
  } = await zParse(rulePresetParamsRequestSchema, req);
  return res.json(await installRulePresetService(DI.em, { appuserKey, tenantKey }, code));
}
