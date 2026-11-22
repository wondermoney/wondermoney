"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { track } from "@/lib/analytics/track";
import { useUser } from "@/lib/auth/user-context";
import {
  FIRST_RUN_STEPS,
  getFirstRunState,
  getFirstRunStepFromPathname,
  getFirstRunStepRoute,
  markFirstRunStarted,
  patchFirstRunState,
} from "@/lib/onboarding/firstRunOnboarding";

import FirstRunOnboardingShell from "./FirstRunOnboardingShell";

const FirstRunOnboardingFooterContext = createContext<
  ((footer: ReactNode) => void) | null
>(null);

export function useFirstRunOnboardingFooter() {
  const setFooter = useContext(FirstRunOnboardingFooterContext);

  if (!setFooter) {
    throw new Error(
      "useFirstRunOnboardingFooter must be used within FirstRunOnboardingRouteShell",
    );
  }

  return setFooter;
}

export default function FirstRunOnboardingRouteShell({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations("onboarding.firstRun");
  const pathname = usePathname();
  const router = useRouter();
  const user = useUser();
  const [canRender, setCanRender] = useState(false);
  const [footer, setFooter] = useState<ReactNode>(null);
  const viewedStepsRef = useRef<Set<string>>(new Set());

  const currentStep = getFirstRunStepFromPathname(pathname) ?? "welcome";
  const currentStepIndex = Math.max(0, FIRST_RUN_STEPS.indexOf(currentStep));
  const progressLabel = t("progress", {
    current: currentStepIndex + 1,
    total: FIRST_RUN_STEPS.length,
  });
  const stepLabel = t(`stepLabels.${currentStep}`);

  const hasBackStep = currentStepIndex > 0 && currentStep !== "completion";

  // canRender gates the step until this effect has read and persisted the
  // first-run state (localStorage) and recorded analytics; it has to flip
  // after those side effects, so it is set here deliberately.
  useEffect(() => {
    if (!user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setCanRender(false);
      return;
    }

    const previousState = getFirstRunState(user.id);
    if (previousState.status === "completed") {
      setCanRender(false);
      router.replace("/");
      return;
    }

    const startedState =
      previousState.status === "not_started"
        ? markFirstRunStarted(user.id)
        : previousState;
    const nextState =
      startedState.currentStep === currentStep
        ? startedState
        : patchFirstRunState({ currentStep }, user.id);

    if (previousState.status === "not_started") track("onboarding_started");

    if (!viewedStepsRef.current.has(currentStep)) {
      viewedStepsRef.current.add(currentStep);
      track("onboarding_step_viewed", { step: currentStep });
    }

    setCanRender(true);
  }, [currentStep, router, user?.id]);

  if (!canRender) return null;

  if (hasBackStep) {
    const previousStep = FIRST_RUN_STEPS[currentStepIndex - 1];

    return (
      <FirstRunOnboardingShell
        stepIndex={currentStepIndex}
        totalSteps={FIRST_RUN_STEPS.length}
        stepLabel={stepLabel}
        progressLabel={progressLabel}
        footerActions={footer}
        onBack={() => {
          router.push(getFirstRunStepRoute(previousStep));
        }}
        backLabel={t("back")}
      >
        <FirstRunOnboardingFooterContext.Provider value={setFooter}>
          {children}
        </FirstRunOnboardingFooterContext.Provider>
      </FirstRunOnboardingShell>
    );
  }

  return (
    <FirstRunOnboardingShell
      stepIndex={currentStepIndex}
      totalSteps={FIRST_RUN_STEPS.length}
      stepLabel={stepLabel}
      progressLabel={progressLabel}
      footerActions={footer}
    >
      <FirstRunOnboardingFooterContext.Provider value={setFooter}>
        {children}
      </FirstRunOnboardingFooterContext.Provider>
    </FirstRunOnboardingShell>
  );
}
