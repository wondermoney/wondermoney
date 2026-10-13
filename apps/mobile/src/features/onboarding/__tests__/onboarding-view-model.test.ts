import type { OnboardingStateDto } from '../onboarding-contract'
import { mapOnboardingState } from '../onboarding-view-model'

const state = (over: Partial<OnboardingStateDto> = {}): OnboardingStateDto => ({
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
  ...over,
})

describe('mapOnboardingState', () => {
  it('preserves the required, completed, completedVersion, version, and skippable flags verbatim', () => {
    const view = mapOnboardingState(state({ required: true, completed: false, completedVersion: null, skippable: true, version: 1 }))
    expect(view.required).toBe(true)
    expect(view.completed).toBe(false)
    expect(view.completedVersion).toBeNull()
    expect(view.version).toBe(1)
    expect(view.skippable).toBe(true)
  })

  it('derives the per-card content and the supported action projections', () => {
    const view = mapOnboardingState(state({ steps: [
      { done: true, key: 'net_worth_value' },
      { done: false, key: 'privacy' },
    ] }))
    expect(view.cards).toEqual([
      { done: true, key: 'net_worth_value' },
      { done: false, key: 'privacy' },
    ])
    expect(view.primaryActionAvailable).toBe(true)
    expect(view.skipActionAvailable).toBe(true)
    expect(view.supportedActions).toEqual(['connect_bank', 'skip'])
  })

  it('hides the skip action when the server says the journey is not skippable', () => {
    const view = mapOnboardingState(state({ skippable: false, supportedActions: ['connect_bank'] }))
    expect(view.skipActionAvailable).toBe(false)
    expect(view.primaryActionAvailable).toBe(true)
  })

  it('hides the connect-bank action when the server omits it from supportedActions', () => {
    const view = mapOnboardingState(state({ supportedActions: ['skip'] }))
    expect(view.primaryActionAvailable).toBe(false)
    expect(view.skipActionAvailable).toBe(true)
  })

  it('exposes the create-manual-account action when the server lists it in supportedActions', () => {
    const view = mapOnboardingState(state({ supportedActions: ['connect_bank', 'create_manual_account', 'skip'] }))
    expect(view.createAccountActionAvailable).toBe(true)
  })

  it('hides the create-manual-account action when the server omits it from supportedActions', () => {
    const view = mapOnboardingState(state({ supportedActions: ['connect_bank', 'skip'] }))
    expect(view.createAccountActionAvailable).toBe(false)
  })
})
