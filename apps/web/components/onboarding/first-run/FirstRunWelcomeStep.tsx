"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronRight, Layers3, ShieldCheck, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { getFirstRunStepRoute } from "@/lib/onboarding/firstRunOnboarding";

import FirstRunIconTile, { type FirstRunIconTone } from "./FirstRunIconTile";
import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import { FirstRunSplit, FirstRunStepIntro } from "./FirstRunStepScaffold";

export default function FirstRunWelcomeStep() {
  const t = useTranslations("onboarding.firstRun");
  const setFooter = useFirstRunOnboardingFooter();

  useEffect(() => {
    setFooter(<FirstRunWelcomeFooter />);

    return () => setFooter(null);
  }, [setFooter]);

  return (
    <FirstRunSplit
      copy={
        <div className="space-y-7">
          <FirstRunStepIntro
            headline={t("welcome.headline")}
            sub={t("welcome.description")}
          />
          <div className="space-y-4">
            <FactRow
              icon={Layers3}
              tone="violet"
              title={t("proof.common.facts.connected.title")}
              description={t("proof.common.facts.connected.description")}
            />
            <FactRow
              icon={ShieldCheck}
              tone="slate"
              title={t("proof.common.facts.readOnly.title")}
              description={t("proof.common.facts.readOnly.description")}
            />
            <FactRow
              icon={TrendingUp}
              tone="green"
              title={t("proof.common.facts.netWorth.title")}
              description={t("proof.common.facts.netWorth.description")}
            />
          </div>
        </div>
      }
      preview={null}
    />
  );
}

function FactRow({
  icon,
  tone,
  title,
  description,
}: {
  icon: LucideIcon;
  tone: FirstRunIconTone;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <FirstRunIconTile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm leading-6 font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-sm leading-6">
          {description}
        </p>
      </div>
    </div>
  );
}

function FirstRunWelcomeFooter() {
  const t = useTranslations("onboarding.firstRun");
  const router = useRouter();

  return (
    <Button
      type="button"
      className="min-h-11 transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      onClick={() => {
        router.push(getFirstRunStepRoute("goals"));
      }}
    >
      {t("welcome.cta")}
      <ChevronRight className="ml-1 size-4" />
    </Button>
  );
}
