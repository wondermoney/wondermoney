"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import useOnboarding from "@/lib/api/user/useOnboarding";
import useUpdateOnboarding from "@/lib/api/user/useUpdateOnboarding";
import { useUser } from "@/lib/auth/user-context";

import { DrawerDialog } from "../ui/dialog-responsive";
import { LearningTip } from "../ui/learning-tip";
import { OnboardingCarousel } from "./OnboardingCarousel";

function YearlyStatsPreview() {
  const stats = [
    { label: "Income planned", value: "€36,000", color: "" },
    { label: "Expenses planned", value: "€24,000", color: "" },
    { label: "Yearly result", value: "€12,000", color: "text-success-text" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="border-border bg-card rounded-lg border p-4"
        >
          <p className="text-muted-foreground text-[10px]">{stat.label}</p>
          <p className={`mt-1 font-mono text-xl font-semibold ${stat.color}`}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function YearlyCategoryTablePreview() {
  const categories = [
    { name: "Housing", budgeted: "€18,000", spent: "€14,400", pct: 80 },
    { name: "Food & Dining", budgeted: "€6,000", spent: "€3,900", pct: 65 },
    { name: "Transport", budgeted: "€2,400", spent: "€960", pct: 40 },
    { name: "Entertainment", budgeted: "€1,200", spent: "€720", pct: 60 },
  ];

  return (
    <div className="border-border bg-card rounded-lg border">
      <div className="border-border text-muted-foreground grid grid-cols-4 gap-2 border-b px-4 py-2 text-[10px] font-medium">
        <span>Category</span>
        <span className="text-right">Budgeted</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Progress</span>
      </div>
      <div className="divide-border divide-y">
        {categories.map((cat) => (
          <div
            key={cat.name}
            className="grid grid-cols-4 items-center gap-2 px-4 py-2.5"
          >
            <span className="text-sm">{cat.name}</span>
            <span className="text-muted-foreground text-right font-mono text-xs">
              {cat.budgeted}
            </span>
            <span className="text-right font-mono text-xs font-medium">
              {cat.spent}
            </span>
            <div className="flex items-center justify-end gap-2">
              <div className="bg-muted h-1.5 w-12 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${cat.pct}%` }}
                />
              </div>
              <span className="text-muted-foreground text-[10px]">
                {cat.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="border-border border-t px-4 py-2.5">
        <div className="grid grid-cols-4 items-center gap-2">
          <span className="text-sm font-medium">Total</span>
          <span className="text-muted-foreground text-right font-mono text-xs font-medium">
            €27,600
          </span>
          <span className="text-right font-mono text-xs font-semibold">
            €19,980
          </span>
          <div className="flex items-center justify-end gap-2">
            <div className="bg-muted h-1.5 w-12 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: "72%" }}
              />
            </div>
            <span className="text-muted-foreground text-[10px]">72%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function YearlyYTDPreview() {
  const rows = [
    {
      label: "Year to date",
      spent: "€3,350",
      budgeted: "€4,400",
      remaining: "€1,050",
      pct: 76,
    },
    {
      label: "Full year",
      spent: "€3,350",
      budgeted: "€27,600",
      remaining: "€24,250",
      pct: 12,
    },
  ];

  return (
    <div className="border-border bg-card rounded-lg border">
      <div className="border-border text-muted-foreground grid grid-cols-5 gap-2 border-b px-4 py-2 text-[10px] font-medium">
        <span>Period</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Budgeted</span>
        <span className="text-right">Remaining</span>
        <span className="text-right">Progress</span>
      </div>
      <div className="divide-border divide-y">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-5 items-center gap-2 px-4 py-3"
          >
            <span className="text-sm font-medium">{row.label}</span>
            <span className="text-right font-mono text-xs">{row.spent}</span>
            <span className="text-muted-foreground text-right font-mono text-xs">
              {row.budgeted}
            </span>
            <span className="text-success-text text-right font-mono text-xs font-medium">
              {row.remaining}
            </span>
            <div className="flex items-center justify-end gap-2">
              <div className="bg-muted h-1.5 w-10 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${row.pct}%` }}
                />
              </div>
              <span className="text-muted-foreground text-[10px]">
                {row.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BudgetsYearlyViewOnboarding() {
  const t = useTranslations();
  const user = useUser();
  const { data: onboardingData } = useOnboarding(user?.id);
  const [isYearlyBudgetsOnboardingOpen, setIsYearlyBudgetsOnboardingOpen] =
    useState(false);

  const shouldShowYearlyBudgetsOnboarding = onboardingData?.onboarding.some(
    (o) => o.step === 5 && !o.done,
  );

  const updateOnboardingMutation = useUpdateOnboarding({
    userId: user?.id!,
    stepId: 5,
  });

  useEffect(() => {
    if (shouldShowYearlyBudgetsOnboarding !== undefined) {
      const timer = setTimeout(() => {
        if (shouldShowYearlyBudgetsOnboarding) {
          setIsYearlyBudgetsOnboardingOpen(true);
          updateOnboardingMutation.mutate();
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [shouldShowYearlyBudgetsOnboarding, updateOnboardingMutation]);

  const onboardingSlides = [
    {
      preview: <YearlyStatsPreview />,
      content: t("onboarding.budgets-yearly.content1"),
    },
    {
      preview: <YearlyCategoryTablePreview />,
      content: t("onboarding.budgets-yearly.content2"),
    },
    {
      preview: <YearlyYTDPreview />,
      content: t("onboarding.budgets-yearly.content3"),
    },
  ];

  return (
    <DrawerDialog
      title={t("onboarding.budgets-yearly.title")}
      description={t("onboarding.budgets-yearly.description")}
      onOpen={() => updateOnboardingMutation.mutate()}
      open={isYearlyBudgetsOnboardingOpen}
      onOpenChange={setIsYearlyBudgetsOnboardingOpen}
      trigger={
        <LearningTip asButton>
          {t("onboarding.budgets-yearly.triggerLabel")}
        </LearningTip>
      }
    >
      <OnboardingCarousel
        slides={onboardingSlides}
        onComplete={() => setIsYearlyBudgetsOnboardingOpen(false)}
        nextLabel={t("next")}
        completeLabel={t("got-it")}
      />
    </DrawerDialog>
  );
}
