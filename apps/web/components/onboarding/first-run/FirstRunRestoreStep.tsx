"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect } from "react";

import DataRestore, { currentRestore } from "@/components/settings/DataRestore";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/Typography";
import { useRouter } from "@/i18n/navigation";
import useCompleteVersionedOnboarding from "@/lib/api/user/useCompleteVersionedOnboarding";
import { useDataRestoreOverview } from "@/lib/api/user/useDataRestore";
import { useUser } from "@/lib/auth/user-context";
import {
  getFirstRunStepRoute,
  markFirstRunCompleted,
} from "@/lib/onboarding/firstRunOnboarding";

import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import { FirstRunCentered, FirstRunStepIntro } from "./FirstRunStepScaffold";

/**
 * Onboarding's other start: restore a WonderMoney export into the new, empty household instead of
 * setting up from scratch. Once the data is back, onboarding is done.
 */
export default function FirstRunRestoreStep() {
  const t = useTranslations();
  const tFirstRun = useTranslations("onboarding.firstRun");
  const setFooter = useFirstRunOnboardingFooter();
  const router = useRouter();
  const user = useUser();
  const { data: overview } = useDataRestoreOverview();
  const completeVersionedOnboarding = useCompleteVersionedOnboarding();
  const restored = currentRestore(overview)?.status === "restored";

  useEffect(() => {
    setFooter(
      restored ? null : (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() => {
            router.push(getFirstRunStepRoute("welcome"));
          }}
        >
          {tFirstRun("restore.back")}
        </Button>
      ),
    );
    return () => setFooter(null);
  }, [restored, router, setFooter, tFirstRun]);

  const onRestored = useCallback(() => {
    if (!user?.id) return;
    markFirstRunCompleted(user.id);
    completeVersionedOnboarding.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate identity is stable per mutation instance
  }, [user?.id]);

  const reason = overview?.availability.reason;
  const unavailable =
    overview &&
    !overview.availability.eligible &&
    !restored &&
    currentRestore(overview)?.status !== "restoring";

  return (
    <FirstRunCentered>
      <div className="space-y-7">
        <FirstRunStepIntro
          headline={tFirstRun("restore.headline")}
          sub={tFirstRun("restore.description")}
        />
        {unavailable && reason ? (
          <Text variant="mutedText" role="status">
            {t(`privacy-data-restore-unavailable-${reason}`)}
          </Text>
        ) : (
          <DataRestore
            onRestored={onRestored}
            restoredAction={
              <Button
                type="button"
                className="min-h-11"
                onClick={() => router.replace("/")}
              >
                {tFirstRun("restore.done")}
              </Button>
            }
          />
        )}
      </div>
    </FirstRunCentered>
  );
}
