import {
  FIRST_RUN_GOALS,
  FIRST_RUN_MAX_GOALS,
  FIRST_RUN_ONBOARDING_STORAGE_KEY,
  FIRST_RUN_STEPS,
  type FirstRunGoal,
  type FirstRunOnboardingState,
  type FirstRunStep,
} from "./types";
import {
  FIRST_RUN_ACCOUNT_STEPS,
  FIRST_RUN_BUDGET_STEPS,
  FIRST_RUN_HANDOFFS,
  FIRST_RUN_PORTFOLIO_STEPS,
  FIRST_RUN_STATUSES,
} from "./validation";

export function createInitialFirstRunState(): FirstRunOnboardingState {
  return {
    status: "not_started",
    currentStep: "welcome",
    selectedGoals: [],
    accountStep: "not_started",
    budgetStep: "not_started",
    portfolioStep: "not_started",
  };
}

function getFirstRunStorageKey(userId?: string): string {
  return userId
    ? `${FIRST_RUN_ONBOARDING_STORAGE_KEY}:${userId}`
    : FIRST_RUN_ONBOARDING_STORAGE_KEY;
}

function isOneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function normalizeCurrentStep(value: unknown): FirstRunStep {
  if (value === "budget" || value === "portfolio") return "completion";
  return isOneOf(FIRST_RUN_STEPS, value)
    ? value
    : createInitialFirstRunState().currentStep;
}

export function isFirstRunGoal(value: string): value is FirstRunGoal {
  return isOneOf(FIRST_RUN_GOALS, value);
}

export function normalizeGoals(goals: unknown): FirstRunGoal[] {
  if (!Array.isArray(goals)) return [];

  const validGoals = goals.filter(
    (goal): goal is FirstRunGoal =>
      typeof goal === "string" && isFirstRunGoal(goal),
  );
  return Array.from(new Set(validGoals)).slice(0, FIRST_RUN_MAX_GOALS);
}

export function getFirstRunState(userId?: string): FirstRunOnboardingState {
  if (typeof window === "undefined") return createInitialFirstRunState();

  try {
    const storageKey = getFirstRunStorageKey(userId);
    const raw = window.localStorage.getItem(storageKey);

    if (userId) {
      const unscopedStorageKey = getFirstRunStorageKey();
      const unscopedRaw = window.localStorage.getItem(unscopedStorageKey);

      if (unscopedRaw) {
        try {
          const unscopedState = parseFirstRunState(JSON.parse(unscopedRaw));

          if (unscopedState.status === "completed") {
            window.localStorage.removeItem(unscopedStorageKey);

            if (!raw) {
              window.localStorage.setItem(
                storageKey,
                JSON.stringify(unscopedState),
              );
              return unscopedState;
            }
          }
        } catch {
          // Ignore invalid legacy unscoped state and continue with the scoped key.
        }
      }
    }

    if (!raw) {
      return createInitialFirstRunState();
    }
    return parseFirstRunState(JSON.parse(raw));
  } catch {
    return createInitialFirstRunState();
  }
}

export function setFirstRunState(
  state: FirstRunOnboardingState,
  userId?: string,
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getFirstRunStorageKey(userId),
      JSON.stringify(state),
    );
  } catch {
    // Treat storage as best-effort. The flow still works for the current render.
  }
}

export function patchFirstRunState(
  patch: Partial<FirstRunOnboardingState>,
  userId?: string,
): FirstRunOnboardingState {
  const nextState = { ...getFirstRunState(userId), ...patch };
  setFirstRunState(nextState, userId);
  return nextState;
}

function parseFirstRunState(rawState: unknown): FirstRunOnboardingState {
  if (!rawState || typeof rawState !== "object") {
    return createInitialFirstRunState();
  }

  const state = rawState as Record<string, unknown>;
  const initialState = createInitialFirstRunState();
  const parsed: FirstRunOnboardingState = {
    status:
      state.status === "in_progress" && state.currentStep === "completion"
        ? "completed"
        : isOneOf(FIRST_RUN_STATUSES, state.status)
          ? state.status
          : initialState.status,
    currentStep: normalizeCurrentStep(state.currentStep),
    selectedGoals: normalizeGoals(state.selectedGoals),
    accountStep: isOneOf(FIRST_RUN_ACCOUNT_STEPS, state.accountStep)
      ? state.accountStep
      : initialState.accountStep,
    budgetStep: isOneOf(FIRST_RUN_BUDGET_STEPS, state.budgetStep)
      ? state.budgetStep
      : initialState.budgetStep,
    portfolioStep: isOneOf(FIRST_RUN_PORTFOLIO_STEPS, state.portfolioStep)
      ? state.portfolioStep
      : initialState.portfolioStep,
  };

  if (isOneOf(FIRST_RUN_HANDOFFS, state.activeHandoff)) {
    parsed.activeHandoff = state.activeHandoff;
  }

  if (typeof state.startedAt === "string") {
    parsed.startedAt = state.startedAt;
  }

  if (typeof state.completedAt === "string") {
    parsed.completedAt = state.completedAt;
  }

  return parsed;
}
