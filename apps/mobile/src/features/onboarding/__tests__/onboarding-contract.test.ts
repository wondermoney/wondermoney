import {
  completeOnboardingRequestSchema,
  createCompleteOnboardingEndpoint,
  createOnboardingBootstrapEndpoint,
  onboardingBootstrapResponseSchema,
  onboardingStateSchema,
  onboardingStepSchema,
  onboardingSupportedActionSchema,
} from '../onboarding-contract'

const baseState = {
  completed: false,
  completedVersion: null,
  required: true,
  skippable: true,
  steps: [
    { done: false, key: 'net_worth_value' },
    { done: false, key: 'read_only_bank_access' },
    { done: false, key: 'privacy' },
  ],
  supportedActions: ['connect_bank', 'skip'],
  version: 1,
} as const

describe('onboarding contract', () => {
  it('accepts the full new-user bootstrap shape with two supported actions and three step keys', () => {
    const parsed = onboardingBootstrapResponseSchema.parse({ onboarding: baseState })
    expect(parsed.onboarding.required).toBe(true)
    expect(parsed.onboarding.supportedActions).toEqual(['connect_bank', 'skip'])
    expect(parsed.onboarding.steps.map((s) => s.key)).toEqual(['net_worth_value', 'read_only_bank_access', 'privacy'])
  })

  it('strips fields the API adds and drops supported actions this build cannot route to', () => {
    const parsed = onboardingStateSchema.parse({
      ...baseState,
      legacyStepIds: [1, 2, 3],
      steps: [{ done: false, key: 'privacy', estimatedMinutes: 2 }],
      supportedActions: ['connect_bank', 'import_csv', 'skip'],
    })
    expect(parsed).not.toHaveProperty('legacyStepIds')
    expect(parsed.steps).toEqual([{ done: false, key: 'privacy' }])
    expect(parsed.supportedActions).toEqual(['connect_bank', 'skip'])
    expect(onboardingStateSchema.safeParse({ ...baseState, supportedActions: [1] }).success).toBe(false)
  })

  it('rejects an empty step key', () => {
    expect(onboardingStepSchema.safeParse({ done: false, key: '' }).success).toBe(false)
  })

  it('rejects unsupported action values and non-integer versions', () => {
    expect(onboardingSupportedActionSchema.safeParse('delete_account').success).toBe(false)
    expect(onboardingStateSchema.safeParse({ ...baseState, version: 1.5 }).success).toBe(false)
    expect(onboardingStateSchema.safeParse({ ...baseState, completedVersion: -1 }).success).toBe(false)
  })

  it('accepts create_manual_account as a supported action', () => {
    expect(onboardingSupportedActionSchema.safeParse('create_manual_account').success).toBe(true)
    expect(
      onboardingStateSchema.safeParse({ ...baseState, supportedActions: ['connect_bank', 'create_manual_account', 'skip'] }).success,
    ).toBe(true)
  })

  it('keeps null completedVersion explicit and preserves a real zero', () => {
    expect(
      onboardingStateSchema.parse({ ...baseState, completed: true, completedVersion: 0 }).completedVersion,
    ).toBe(0)
    expect(onboardingStateSchema.parse(baseState).completedVersion).toBeNull()
  })

  it('exposes the GET bootstrap and POST complete endpoints at the documented paths with the right methods', () => {
    expect(createOnboardingBootstrapEndpoint()).toEqual({
      method: 'GET',
      path: '/v1/user/me/onboarding',
      schema: onboardingBootstrapResponseSchema,
    })
    expect(createCompleteOnboardingEndpoint()).toEqual({
      method: 'POST',
      path: '/v1/user/me/onboarding/complete',
      schema: onboardingBootstrapResponseSchema,
    })
  })

  it('accepts any non-negative integer version so a stale client gets a clear 400 from the server', () => {
    expect(completeOnboardingRequestSchema.parse({ version: 1 })).toEqual({ version: 1 })
    expect(completeOnboardingRequestSchema.parse({ version: 0 })).toEqual({ version: 0 })
    expect(completeOnboardingRequestSchema.safeParse({ version: -1 }).success).toBe(false)
    expect(completeOnboardingRequestSchema.safeParse({ version: 1.5 }).success).toBe(false)
  })
})
