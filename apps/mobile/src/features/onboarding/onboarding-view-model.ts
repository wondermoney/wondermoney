import type {
  OnboardingStateDto,
  OnboardingStepDto,
  OnboardingSupportedAction,
} from './onboarding-contract'

/**
 * Per-card content the journey renders. v1 is short and static; the keys come
 * from the server's `steps[].key` so the client can never invent a step the
 * server hasn't listed.
 */
export type OnboardingJourneyCard = Readonly<{
  key: string
  done: boolean
}>

export type OnboardingJourneyView = Readonly<{
  required: boolean
  completed: boolean
  completedVersion: number | null
  version: number
  skippable: boolean
  supportedActions: readonly OnboardingSupportedAction[]
  cards: readonly OnboardingJourneyCard[]
  primaryActionAvailable: boolean
  skipActionAvailable: boolean
  createAccountActionAvailable: boolean
}>

const SUPPORTED_ACTIONS = new Set<OnboardingSupportedAction>(['connect_bank', 'create_manual_account', 'skip'])

function isSupportedAction(value: OnboardingSupportedAction): value is OnboardingSupportedAction {
  return SUPPORTED_ACTIONS.has(value)
}

function projectCards(steps: readonly OnboardingStepDto[]): readonly OnboardingJourneyCard[] {
  return steps.map((step) => ({ done: step.done, key: step.key }))
}

export function mapOnboardingState(state: OnboardingStateDto): OnboardingJourneyView {
  return {
    cards: projectCards(state.steps),
    completed: state.completed,
    completedVersion: state.completedVersion,
    createAccountActionAvailable: state.supportedActions.some((action): action is 'create_manual_account' => action === 'create_manual_account' && isSupportedAction(action)),
    primaryActionAvailable: state.supportedActions.some((action): action is 'connect_bank' => action === 'connect_bank' && isSupportedAction(action)),
    required: state.required,
    skipActionAvailable: state.skippable && state.supportedActions.some((action): action is 'skip' => action === 'skip' && isSupportedAction(action)),
    skippable: state.skippable,
    supportedActions: [...state.supportedActions],
    version: state.version,
  }
}
