import type { Request, Response } from 'express';

import { Appuser } from '@entity/Appuser';
import { InternalServerError } from '@utils/errors';
import { completeOnboardingRequestSchema } from '@validators/onboarding';
import { zParse } from '@validators/parser';

import { DI } from '../app.js';
import { CURRENT_ONBOARDING_VERSION, ONBOARDING_REQUIRED_FOR_USERS_CREATED_FROM } from '../onboarding-version.js';

/**
 * RAD-226 — server-authoritative versioned onboarding bootstrap and idempotent
 * completion mutation. The versioned DTO replaces the legacy numeric-step
 * `getOnboarding` / `completeOnboardingStep` endpoints. Users who already
 * existed when RAD-601 shipped are protected from re-onboarding: they resolve
 * to `required:false, completed:true, completedVersion:0` forever. Users
 * created after that cutoff resolve to `required:true,
 * completed:false` until they call the completion mutation with the current
 * version; that call is idempotent and survives reinstall/cross-device sign-in
 * because the completion is persisted against the appuser.
 */

const STEP_KEYS = ['net_worth_value', 'read_only_bank_access', 'privacy'] as const;

const SUPPORTED_ACTIONS = ['connect_bank', 'create_manual_account', 'skip'] as const;

interface OnboardingStateDto {
  completed: boolean;
  completedVersion: null | number;
  required: boolean;
  skippable: boolean;
  steps: readonly { done: boolean; key: string }[];
  supportedActions: readonly SupportedAction[];
  version: number;
}

type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

export async function completeOnboarding(req: Request, res: Response) {
  // The literal schema above guarantees version === CURRENT_ONBOARDING_VERSION.
  await zParse(completeOnboardingRequestSchema, req);
  const appuser = await loadActiveAppuser(req);
  if (!hasCurrentVersionCompletion(appuser)) {
    appuser.onboardingCompletedAt = new Date();
    appuser.onboardingCompletedVersion = CURRENT_ONBOARDING_VERSION;
    await DI.em.persist(appuser).flush();
  }
  return res.json({ onboarding: computeState(appuser) });
}

export async function getOnboardingBootstrap(req: Request, res: Response) {
  const appuser = await loadActiveAppuser(req);
  return res.json({ onboarding: computeState(appuser) });
}

function buildState(input: {
  completed: boolean;
  completedVersion: null | number;
  required: boolean;
}): OnboardingStateDto {
  return {
    completed: input.completed,
    completedVersion: input.completedVersion,
    required: input.required,
    skippable: true,
    steps: STEP_KEYS.map((key) => ({ done: input.completed, key })),
    supportedActions: [...SUPPORTED_ACTIONS],
    version: CURRENT_ONBOARDING_VERSION,
  };
}

function computeState(appuser: Appuser): OnboardingStateDto {
  if (hasCurrentVersionCompletion(appuser)) {
    return buildState({ completed: true, completedVersion: CURRENT_ONBOARDING_VERSION, required: false });
  }
  // RAD-601 — anyone who already existed when the cutoff shipped is treated as
  // v0 and protected forever, even after future content bumps. This used to key
  // off the presence of an `appuser_onboarding` row, but `createUser` gives
  // every new account one at registration, so the check matched everybody and
  // the journey was unreachable. See ONBOARDING_REQUIRED_FOR_USERS_CREATED_FROM.
  if (appuser.createdAt < ONBOARDING_REQUIRED_FOR_USERS_CREATED_FROM) {
    return buildState({ completed: true, completedVersion: 0, required: false });
  }
  return buildState({ completed: false, completedVersion: null, required: true });
}

function hasCurrentVersionCompletion(appuser: Appuser): boolean {
  return appuser.onboardingCompletedVersion === CURRENT_ONBOARDING_VERSION;
}

async function loadActiveAppuser(req: Request): Promise<Appuser> {
  if (!req.user || !req.tenant) {
    throw new InternalServerError('Authenticated user and tenant are required');
  }
  const appuser = await DI.em.findOne(
    Appuser,
    { appuserKey: req.user.appuserKey, deletedAt: undefined, recordActive: true },
  );
  if (!appuser) {
    throw new InternalServerError('User not found');
  }
  return appuser;
}
