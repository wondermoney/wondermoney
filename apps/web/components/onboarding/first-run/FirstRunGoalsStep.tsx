"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useUser } from "@/lib/auth/user-context";
import {
  FIRST_RUN_EVENTS,
  type FirstRunGoal,
  getFirstRunState,
  getFirstRunStepRoute,
  patchFirstRunState,
} from "@/lib/onboarding/firstRunOnboarding";
import {
  ACTIVATION_EVENTS,
  captureActivationEvent,
} from "@/lib/utils/analytics";

import FirstRunGoalSelector from "./FirstRunGoalSelector";
import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import { FirstRunCentered, FirstRunStepIntro } from "./FirstRunStepScaffold";

export default function FirstRunGoalsStep() {
  const t = useTranslations("onboarding.firstRun");
  const user = useUser();
  const setFooter = useFirstRunOnboardingFooter();
  // Load the saved goals for the signed-in user. The route shell only renders
  // this step on the client, after it has initialised the first-run state, so
  // reading it here is safe; a change of user reloads it during render.
  const userId = user?.id;
  const [selectedGoals, setSelectedGoals] = useState<FirstRunGoal[]>(() =>
    userId ? getFirstRunState(userId).selectedGoals : [],
  );
  const [goalsLoadedFor, setGoalsLoadedFor] = useState(userId);
  if (userId !== goalsLoadedFor) {
    setGoalsLoadedFor(userId);
    if (userId) setSelectedGoals(getFirstRunState(userId).selectedGoals);
  }

  useEffect(() => {
    setFooter(<FirstRunGoalsFooter selectedGoals={selectedGoals} />);

    return () => setFooter(null);
  }, [selectedGoals, setFooter]);

  return (
    <FirstRunCentered>
      <div className="space-y-7">
        <FirstRunStepIntro
          headline={t("goals.headline")}
          sub={t("goals.description")}
        />
        <div className="space-y-3">
          <FirstRunGoalSelector
            ariaLabel={t("goals.headline")}
            selectedGoals={selectedGoals}
            getLabel={(goal) => t(`goals.options.${goal}`)}
            getHelper={(goal) => t(`goals.helpers.${goal}`)}
            onChange={(goals) => {
              setSelectedGoals(goals);
              if (user?.id)
                patchFirstRunState({ selectedGoals: goals }, user.id);
            }}
          />
          <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
            <Info className="size-4 shrink-0" />
            {t("goals.maxSelected")}
          </p>
        </div>
      </div>
    </FirstRunCentered>
  );
}

function FirstRunGoalsFooter({
  selectedGoals,
}: {
  selectedGoals: FirstRunGoal[];
}) {
  const t = useTranslations("onboarding.firstRun");
  const posthog = usePostHog();
  const router = useRouter();
  const user = useUser();

  const handleSkip = () => {
    posthog?.capture(FIRST_RUN_EVENTS.goalsSelected, {
      selected_goals: [],
      goal_count: 0,
      skipped: true,
    });
    posthog?.capture(FIRST_RUN_EVENTS.stepSkipped, {
      step: "goals",
      selected_goals: [],
    });
    captureActivationEvent(posthog, ACTIVATION_EVENTS.onboardingStepCompleted, {
      goal_count: 0,
      skipped: true,
      step: "goals",
    });
    if (user?.id) {
      patchFirstRunState(
        { selectedGoals: [], currentStep: "privacy" },
        user.id,
      );
    }
    router.push(getFirstRunStepRoute("privacy"));
  };

  const handleContinue = () => {
    posthog?.capture(FIRST_RUN_EVENTS.goalsSelected, {
      selected_goals: selectedGoals,
      goal_count: selectedGoals.length,
      skipped: false,
    });
    captureActivationEvent(posthog, ACTIVATION_EVENTS.onboardingStepCompleted, {
      goal_count: selectedGoals.length,
      skipped: false,
      step: "goals",
    });
    if (user?.id) {
      patchFirstRunState({ selectedGoals, currentStep: "privacy" }, user.id);
    }
    router.push(getFirstRunStepRoute("privacy"));
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground min-h-11 transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
        onClick={handleSkip}
      >
        {t("skipStep")}
      </Button>
      <Button
        type="button"
        className="min-h-11 transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
        onClick={handleContinue}
      >
        {t("goals.cta")}
      </Button>
    </div>
  );
}
