"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import Logo from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { useWizardProgress } from "./hooks/useWizardProgress";

export default function BudgetCreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const {
    currentStep,
    stepName,
    totalSteps,
    stepProgress,
    handleGoBack,
    isLastStep,
  } = useWizardProgress();

  return (
    <>
      <div className="bg-background sticky top-0 z-10 flex items-center justify-between p-4 shadow-xs">
        <Logo />
        <div className="ml-auto flex max-w-[60%] flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            {t("budgetWizardProgress.step", {
              current: currentStep + 1,
              total: totalSteps,
              name: t(`budgetWizardProgress.steps.${stepName}`),
            })}
          </p>
          <Progress
            value={stepProgress}
            className="bg-muted w-full"
            aria-label={t("budgetWizardProgress.step", {
              current: currentStep + 1,
              total: totalSteps,
              name: t(`budgetWizardProgress.steps.${stepName}`),
            })}
          />
        </div>
      </div>
      <div className="space-y-4 overflow-auto p-4">
        {!isLastStep && (
          <div className="w-full">
            <Button
              variant="ghost"
              type="button"
              onClick={handleGoBack}
              className="text-muted-foreground pl-0"
            >
              <ArrowLeft className="mr-2" size="16" />
              {t("back")}
            </Button>
          </div>
        )}
        <div className={cn("mx-auto max-w-2xl", isLastStep && "max-w-4xl")}>
          {children}
          <p className="text-muted-foreground mt-6 text-sm">
            {t("budgetWizardProgress.saveNote")}
          </p>
        </div>
      </div>
    </>
  );
}
