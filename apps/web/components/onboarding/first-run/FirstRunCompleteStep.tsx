"use client";

import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import useCompleteVersionedOnboarding from "@/lib/api/user/useCompleteVersionedOnboarding";
import { useUser } from "@/lib/auth/user-context";
import {
  FIRST_RUN_EVENTS,
  getFirstRunState,
  getFirstRunStepRoute,
  markFirstRunCompleted,
} from "@/lib/onboarding/firstRunOnboarding";
import { cn } from "@/lib/utils";
import {
  ACTIVATION_EVENTS,
  captureActivationEvent,
} from "@/lib/utils/analytics";

import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import { FirstRunCentered } from "./FirstRunStepScaffold";

export default function FirstRunCompleteStep() {
  const t = useTranslations("onboarding.firstRun");
  const user = useUser();
  const setFooter = useFirstRunOnboardingFooter();
  const state = getFirstRunState(user?.id);
  const markedRef = useRef(false);
  const completeVersionedOnboarding = useCompleteVersionedOnboarding();

  useEffect(() => {
    setFooter(<FirstRunCompleteFooter />);

    return () => setFooter(null);
  }, [setFooter]);

  // Reaching the celebration screen means onboarding is done. Mark it complete
  // on mount (idempotent) so the flag can't be lost if the user closes the tab
  // or navigates away without pressing the final CTA — otherwise an
  // account-less (skipped) user would be redirected back into the wizard on the
  // next hard load, forever. The CTA still marks + fires analytics.
  //
  // Also report completion to the server (versioned onboarding contract) so
  // `appuser.onboardingCompletedAt` gets persisted — the local flag alone is
  // not reflected server-side. Best-effort: never blocks or gates the
  // local-first flow.
  useEffect(() => {
    if (markedRef.current) return;
    if (!user?.id) return;
    markedRef.current = true;
    markFirstRunCompleted(user.id);
    completeVersionedOnboarding.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate identity is stable per mutation instance; including it would refire on every render
  }, [user?.id]);

  // `skipped` rows say so with a dash, not the success tick: a step the user
  // passed over is not a step that went well.
  const rows: { label: string; detail?: string; skipped?: boolean }[] = [];

  if (state.selectedGoals.length) {
    for (const goal of state.selectedGoals) {
      rows.push({
        label: t("completion.summary.goalsSelected"),
        detail: t(`goals.options.${goal}`),
      });
    }
  } else {
    rows.push({ label: t("completion.summary.goalsSkipped"), skipped: true });
  }

  if (state.accountStep === "connected") {
    rows.push({
      label: t("completion.summary.accountConnected"),
      detail: t("preview.account.totalValue"),
    });
    rows.push({
      label: t("completion.summary.netWorthTracked"),
      detail: t("preview.welcome.netWorthValue"),
    });
  } else if (state.accountStep === "manual_added") {
    rows.push({ label: t("completion.summary.accountManual") });
  } else {
    rows.push({
      label: t("completion.summary.accountSkipped"),
      skipped: true,
    });
  }

  return (
    <FirstRunCentered>
      <div className="flex flex-col items-center text-center">
        <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-md">
          <Check className="size-5" strokeWidth={2.5} />
        </span>
        <h1 className="text-foreground mt-5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t("completion.celebrationHeadline")}
        </h1>
        <p className="text-muted-foreground mt-3 max-w-md text-base leading-7">
          {state.accountStep === "skipped"
            ? t("completion.skippedCelebrationDescription")
            : t("completion.connectedCelebrationDescription")}
        </p>

        <ul className="mt-6 w-full space-y-1.5 text-left">
          {rows.map((row, i) => (
            <li
              key={`${row.label}-${i}`}
              className="border-border bg-card flex min-h-11 items-center gap-3 rounded-md border px-3 py-2"
            >
              {/* Quiet register (DESIGN.md § 5): `-text` ink on the card
                  surface, no tint. The tint this replaced was a raw ramp that
                  did not follow the theme and measured 1.15:1 against the card
                  — invisible as a chip, while dragging the tick it held down to
                  3.05:1 in light mode. Bare `text-success-text` measures
                  5.33:1 light and 8.95:1 dark, and is how the app already draws
                  a success glyph in components/ui/sonner-options.tsx. */}
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center",
                  row.skipped ? "text-muted-foreground" : "text-success-text",
                )}
              >
                {row.skipped ? (
                  <Minus className="size-3" strokeWidth={3} />
                ) : (
                  <Check className="size-3" strokeWidth={3} />
                )}
              </span>
              <span className="text-foreground flex-1 text-sm font-medium">
                {row.label}
              </span>
              {row.detail ? (
                <span className="text-muted-foreground truncate text-sm">
                  {row.detail}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </FirstRunCentered>
  );
}

function FirstRunCompleteFooter() {
  const t = useTranslations("onboarding.firstRun");
  const router = useRouter();
  const posthog = usePostHog();
  const user = useUser();
  const state = getFirstRunState(user?.id);
  const completeVersionedOnboarding = useCompleteVersionedOnboarding();

  const handleComplete = () => {
    const next = markFirstRunCompleted(user?.id);
    // Idempotent server-side: safe to call again even though the
    // mount effect above already reported completion once.
    completeVersionedOnboarding.mutate();
    posthog?.capture(FIRST_RUN_EVENTS.completed, {
      selected_goals: next.selectedGoals,
      account_step: next.accountStep,
      budget_step: next.budgetStep,
      portfolio_step: next.portfolioStep,
      duration_seconds: next.startedAt
        ? Math.max(
            0,
            Math.round(
              (Date.now() - new Date(next.startedAt).getTime()) / 1000,
            ),
          )
        : undefined,
    });
    captureActivationEvent(posthog, ACTIVATION_EVENTS.onboardingStepCompleted, {
      account_step_status: next.accountStep,
      goal_count: next.selectedGoals.length,
      step: "completion",
    });
    captureActivationEvent(posthog, ACTIVATION_EVENTS.onboardingCompleted, {
      account_step_status: next.accountStep,
      goal_count: next.selectedGoals.length,
    });
    router.replace("/");
  };

  return (
    <div className="flex items-center gap-2">
      {state.accountStep === "skipped" ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
          onClick={() => router.push(getFirstRunStepRoute("account"))}
        >
          {t("completion.connectInstead")}
        </Button>
      ) : null}
      <Button
        type="button"
        className="min-h-11 transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
        onClick={handleComplete}
      >
        {t("completion.cta")}
      </Button>
    </div>
  );
}
