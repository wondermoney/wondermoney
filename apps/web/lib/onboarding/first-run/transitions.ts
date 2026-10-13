import {
  getFirstRunState,
  patchFirstRunState,
} from "./storage";
import {
  FIRST_RUN_ONBOARDING_SUPPRESS_DRAWERS_KEY,
  FIRST_RUN_STEPS,
  type FirstRunHandoff,
  type FirstRunOnboardingState,
  type FirstRunStep,
} from "./types";

export function getStepIndex(step: FirstRunStep): number {
  return FIRST_RUN_STEPS.indexOf(step);
}

export function getNextStep(step: FirstRunStep): FirstRunStep {
  const index = getStepIndex(step);
  return FIRST_RUN_STEPS[Math.min(index + 1, FIRST_RUN_STEPS.length - 1)];
}

export function markFirstRunStarted(userId?: string): FirstRunOnboardingState {
  const current = getFirstRunState(userId);
  if (current.status !== "not_started") return current;

  return patchFirstRunState(
    {
      status: "in_progress",
      currentStep: "welcome",
      startedAt: new Date().toISOString(),
    },
    userId,
  );
}

export function markFirstRunCompleted(
  userId?: string,
): FirstRunOnboardingState {
  const next = patchFirstRunState(
    {
      status: "completed",
      currentStep: "completion",
      activeHandoff: undefined,
      completedAt: new Date().toISOString(),
    },
    userId,
  );

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(
        FIRST_RUN_ONBOARDING_SUPPRESS_DRAWERS_KEY,
        "1",
      );
    } catch {
      // Treat storage as best-effort. Existing onboarding may auto-open if this fails.
    }
  }

  return next;
}

export function shouldShowFirstRunOnboarding(userId?: string): boolean {
  return getFirstRunState(userId).status !== "completed";
}

export function startFirstRunHandoff(
  handoff: FirstRunHandoff,
  userId?: string,
): FirstRunOnboardingState {
  return patchFirstRunState(
    { status: "in_progress", activeHandoff: handoff },
    userId,
  );
}

export function completeFirstRunHandoff(
  handoff: FirstRunHandoff,
  patch: Pick<
    Partial<FirstRunOnboardingState>,
    "accountStep" | "budgetStep" | "portfolioStep" | "currentStep"
  >,
  userId?: string,
): boolean {
  const current = getFirstRunState(userId);
  if (current.activeHandoff !== handoff || current.status === "completed") {
    return false;
  }

  patchFirstRunState(
    {
      ...patch,
      activeHandoff: undefined,
      status: "in_progress",
    },
    userId,
  );
  return true;
}

export function cancelFirstRunHandoff(
  handoff: FirstRunHandoff,
  currentStep: FirstRunStep,
  userId?: string,
): boolean {
  const current = getFirstRunState(userId);
  if (current.activeHandoff !== handoff || current.status === "completed") {
    return false;
  }

  patchFirstRunState(
    {
      activeHandoff: undefined,
      currentStep,
      status: "in_progress",
    },
    userId,
  );
  return true;
}

export function consumeExistingOnboardingDrawerSuppression() {
  if (typeof window === "undefined") return false;

  try {
    const shouldSuppress =
      window.sessionStorage.getItem(
        FIRST_RUN_ONBOARDING_SUPPRESS_DRAWERS_KEY,
      ) === "1";
    if (shouldSuppress) {
      window.sessionStorage.removeItem(
        FIRST_RUN_ONBOARDING_SUPPRESS_DRAWERS_KEY,
      );
    }
    return shouldSuppress;
  } catch {
    return false;
  }
}
