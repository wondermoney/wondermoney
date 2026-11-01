import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Appuser } from '@entity/Appuser';

import { CURRENT_ONBOARDING_VERSION } from '../../../onboarding-version.js';

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), flush: vi.fn(), persist: vi.fn() }));

vi.mock('../../../app.js', () => ({
  DI: {
    em: {
      findOne: mocks.findOne,
      flush: mocks.flush,
      persist: (...args: unknown[]) => {
        mocks.persist(...args);
        return { flush: mocks.flush };
      },
    },
  },
}));

import { completeOnboarding, getOnboardingBootstrap } from '../../onboarding.js';

interface OnboardingState {
  completed: boolean;
  completedVersion: null | number;
  required: boolean;
  skippable: boolean;
  steps: readonly { done: boolean; key: string }[];
  supportedActions: readonly string[];
  version: number;
}

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

const onboardingRequest = (overrides: { tenant?: unknown; user?: unknown } = {}) =>
  ({
    body: { version: CURRENT_ONBOARDING_VERSION },
    tenant: { tenantKey: 113 },
    user: { appuserKey: 71 },
    ...overrides,
  }) as unknown as Request;

/** Comfortably after ONBOARDING_REQUIRED_FOR_USERS_CREATED_FROM. */
const CREATED_AFTER_CUTOFF = new Date('2026-09-01T00:00:00.000Z');
/** Comfortably before it — the cohort that must never be re-prompted. */
const CREATED_BEFORE_CUTOFF = new Date('2026-08-01T00:00:00.000Z');

const makeAppuser = (overrides: Partial<{
  createdAt: Date;
  onboardingCompletedAt: Date | undefined;
  onboardingCompletedVersion: number | undefined;
}> = {}) => ({
  createdAt: overrides.createdAt ?? CREATED_AFTER_CUTOFF,
  onboardingCompletedAt: overrides.onboardingCompletedAt ?? undefined,
  onboardingCompletedVersion: overrides.onboardingCompletedVersion ?? undefined,
}) as unknown as Appuser;

const jsonState = (res: Response): OnboardingState => {
  const payload = vi.mocked(res.json).mock.calls[0]?.[0] as { onboarding: OnboardingState };
  return payload.onboarding;
};

describe('getOnboardingBootstrap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authorizes an active appuser in a single query', async () => {
    const user = { appuserKey: 71 };
    const tenant = { tenantKey: 113 };
    mocks.findOne.mockResolvedValue(makeAppuser());
    const res = makeResponse();

    await getOnboardingBootstrap({ tenant, user } as unknown as Request, res);

    // No populate: the versioned flow decides on `createdAt` alone, so the
    // join table is not loaded on every bootstrap.
    expect(mocks.findOne).toHaveBeenCalledExactlyOnceWith(
      Appuser,
      { appuserKey: 71, deletedAt: undefined, recordActive: true },
    );
  });

  it('rejects before querying when request user context is absent', async () => {
    const res = makeResponse();

    await expect(
      getOnboardingBootstrap({ tenant: { tenantKey: 113 } } as unknown as Request, res),
    ).rejects.toThrow('Authenticated user and tenant are required');
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('rejects before querying when request tenant context is absent', async () => {
    const res = makeResponse();

    await expect(
      getOnboardingBootstrap({ user: { appuserKey: 71 } } as unknown as Request, res),
    ).rejects.toThrow('Authenticated user and tenant are required');
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('marks a user created after the cutoff, with no completion, as required and not completed', async () => {
    mocks.findOne.mockResolvedValue(makeAppuser());
    const res = makeResponse();

    await getOnboardingBootstrap(onboardingRequest(), res);

    const state = jsonState(res);
    expect(state).toEqual({
      completed: false,
      completedVersion: null,
      required: true,
      skippable: true,
      steps: [
        { done: false, key: 'net_worth_value' },
        { done: false, key: 'read_only_bank_access' },
        { done: false, key: 'privacy' },
      ],
      supportedActions: ['connect_bank', 'create_manual_account', 'skip'],
      version: CURRENT_ONBOARDING_VERSION,
    });
  });

  it('treats a user created before the cutoff as completed v0 and skips the gate (existing users)', async () => {
    mocks.findOne.mockResolvedValue(makeAppuser({ createdAt: CREATED_BEFORE_CUTOFF }));
    const res = makeResponse();

    await getOnboardingBootstrap(onboardingRequest(), res);

    const state = jsonState(res);
    expect(state.required).toBe(false);
    expect(state.completed).toBe(true);
    expect(state.completedVersion).toBe(0);
    expect(state.steps.every((step) => step.done)).toBe(true);
  });

  it('keeps an existing user protected from a future content bump (pre-cutoff still maps to v0)', async () => {
    mocks.findOne.mockResolvedValue(makeAppuser({ createdAt: CREATED_BEFORE_CUTOFF }));
    const res = makeResponse();

    await getOnboardingBootstrap(onboardingRequest(), res);

    expect(jsonState(res).completedVersion).toBe(0);
  });

  it('does not read the appuser_onboarding join table to decide', async () => {
    // `AppuserRepository.createUser` gives every new account a step-1
    // `appuser_onboarding` row at registration, so deciding from the presence of
    // that row would make every signup look legacy-complete. A user
    // created after the cutoff must be required even though the row is there —
    // an appuser whose collection would throw if touched proves it is not read.
    const appuser = makeAppuser();
    Object.defineProperty(appuser, 'onboarding', {
      get() {
        throw new Error('computeState must not read the appuser_onboarding collection');
      },
    });
    mocks.findOne.mockResolvedValue(appuser);
    const res = makeResponse();

    await getOnboardingBootstrap(onboardingRequest(), res);

    const state = jsonState(res);
    expect(state.required).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('returns required=false when the user already completed the current version', async () => {
    mocks.findOne.mockResolvedValue(
      makeAppuser({
        onboardingCompletedAt: new Date('2026-07-31T12:00:00.000Z'),
        onboardingCompletedVersion: CURRENT_ONBOARDING_VERSION,
      }),
    );
    const res = makeResponse();

    await getOnboardingBootstrap(onboardingRequest(), res);

    const state = jsonState(res);
    expect(state.required).toBe(false);
    expect(state.completed).toBe(true);
    expect(state.completedVersion).toBe(CURRENT_ONBOARDING_VERSION);
    expect(state.steps.every((step) => step.done)).toBe(true);
  });

  it('re-prompts a user whose completed version is older than the current version', async () => {
    mocks.findOne.mockResolvedValue(
      makeAppuser({
        // Stale completion: created after the cutoff, completed a prior version.
        onboardingCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
        onboardingCompletedVersion: 0,
      }),
    );
    const res = makeResponse();

    await getOnboardingBootstrap(onboardingRequest(), res);

    const state = jsonState(res);
    expect(state.required).toBe(true);
    expect(state.completed).toBe(false);
    expect(state.completedVersion).toBeNull();
    expect(state.steps.every((step) => !step.done)).toBe(true);
  });

  it('exposes the exact supported action set, skip semantics, and version without leaking appuser fields', async () => {
    mocks.findOne.mockResolvedValue(makeAppuser());
    const res = makeResponse();

    await getOnboardingBootstrap(onboardingRequest(), res);

    const state = jsonState(res);
    expect(state.supportedActions).toEqual(['connect_bank', 'create_manual_account', 'skip']);
    expect(state.skippable).toBe(true);
    expect(state.version).toBe(CURRENT_ONBOARDING_VERSION);
    expect(Object.keys(state).sort()).toEqual([
      'completed',
      'completedVersion',
      'required',
      'skippable',
      'steps',
      'supportedActions',
      'version',
    ]);
  });
});

describe('completeOnboarding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists completion and returns the updated bootstrap for a new user', async () => {
    const appuser = makeAppuser();
    mocks.findOne.mockResolvedValue(appuser);
    const res = makeResponse();

    await completeOnboarding(onboardingRequest(), res);

    // No populate: the versioned flow decides on `createdAt` alone, so the
    // join table is not loaded on every bootstrap.
    expect(mocks.findOne).toHaveBeenCalledExactlyOnceWith(
      Appuser,
      { appuserKey: 71, deletedAt: undefined, recordActive: true },
    );
    expect(appuser.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(appuser.onboardingCompletedVersion).toBe(CURRENT_ONBOARDING_VERSION);
    expect(mocks.persist).toHaveBeenCalledExactlyOnceWith(appuser);
    expect(mocks.flush).toHaveBeenCalled();
    expect(jsonState(res)).toMatchObject({
      completed: true,
      completedVersion: CURRENT_ONBOARDING_VERSION,
      required: false,
    });
  });

  it('is idempotent: a second call with the current version does not re-persist', async () => {
    const completedAt = new Date('2026-07-31T12:00:00.000Z');
    const appuser = makeAppuser({ onboardingCompletedAt: completedAt, onboardingCompletedVersion: CURRENT_ONBOARDING_VERSION });
    mocks.findOne.mockResolvedValue(appuser);
    const res = makeResponse();

    await completeOnboarding(onboardingRequest(), res);

    expect(mocks.persist).not.toHaveBeenCalled();
    expect(appuser.onboardingCompletedAt).toBe(completedAt);
    expect(appuser.onboardingCompletedVersion).toBe(CURRENT_ONBOARDING_VERSION);
    expect(jsonState(res).completed).toBe(true);
  });

  it('rejects a stale version before querying the database', async () => {
    const res = makeResponse();

    await expect(
      completeOnboarding(
        { body: { version: 0 }, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } } as unknown as Request,
        res,
      ),
    ).rejects.toThrow();
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('rejects before querying when request user or tenant context is absent', async () => {
    const res = makeResponse();

    await expect(
      completeOnboarding({ body: { version: CURRENT_ONBOARDING_VERSION }, tenant: { tenantKey: 113 } } as unknown as Request, res),
    ).rejects.toThrow('Authenticated user and tenant are required');
    await expect(
      completeOnboarding({ body: { version: CURRENT_ONBOARDING_VERSION }, user: { appuserKey: 71 } } as unknown as Request, res),
    ).rejects.toThrow('Authenticated user and tenant are required');
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
