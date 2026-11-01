"use client";

import type { LucideIcon } from "lucide-react";
import { Landmark, Lock, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useUser } from "@/lib/auth/user-context";
import {
  getFirstRunStepRoute,
  patchFirstRunState,
} from "@/lib/onboarding/firstRunOnboarding";

import FirstRunIconTile, { type FirstRunIconTone } from "./FirstRunIconTile";
import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import { FirstRunCentered, FirstRunStepIntro } from "./FirstRunStepScaffold";

const privacyPoints: {
  key: "readOnly" | "bankAuth" | "revoke";
  icon: LucideIcon;
  tone: FirstRunIconTone;
}[] = [
  { key: "readOnly", icon: Lock, tone: "slate" },
  { key: "bankAuth", icon: Landmark, tone: "sky" },
  { key: "revoke", icon: Undo2, tone: "violet" },
];

export default function FirstRunPrivacyStep() {
  const t = useTranslations("onboarding.firstRun");
  const setFooter = useFirstRunOnboardingFooter();

  useEffect(() => {
    setFooter(<FirstRunPrivacyFooter />);

    return () => setFooter(null);
  }, [setFooter]);

  return (
    <FirstRunCentered>
      <div className="space-y-7">
        <FirstRunStepIntro
          headline={t("privacy.headline")}
          sub={t("privacy.description")}
        />
        <div className="space-y-5">
          {privacyPoints.map(({ key, icon, tone }) => (
            <div key={key} className="flex items-start gap-3.5">
              <FirstRunIconTile icon={icon} tone={tone} />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm leading-6 font-medium">
                  {t(`privacy.bullets.${key}.title`)}
                </p>
                <p className="text-muted-foreground mt-0.5 text-sm leading-6">
                  {t(`privacy.bullets.${key}.description`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </FirstRunCentered>
  );
}

function FirstRunPrivacyFooter() {
  const t = useTranslations("onboarding.firstRun");
  const router = useRouter();
  const user = useUser();

  const handleContinue = () => {
    if (user?.id) patchFirstRunState({ currentStep: "account" }, user.id);
    router.push(getFirstRunStepRoute("account"));
  };

  return (
    <Button
      type="button"
      className="min-h-11 transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      onClick={handleContinue}
    >
      {t("continue")}
    </Button>
  );
}
