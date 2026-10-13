"use client";

import { ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import useOnboarding from "@/lib/api/user/useOnboarding";
import useUpdateOnboarding from "@/lib/api/user/useUpdateOnboarding";
import { useUser } from "@/lib/auth/user-context";

import { Amount } from "../ui/Amount";
import { DrawerDialog } from "../ui/dialog-responsive";
import { LearningTip } from "../ui/learning-tip";
import { OnboardingCarousel } from "./OnboardingCarousel";

function MonthlyBudgetTablePreview() {
  const categories = [
    { name: "Housing", budgeted: 1500, spent: 1200, pct: 80 },
    { name: "Food & Dining", budgeted: 500, spent: 380, pct: 76 },
    { name: "Transport", budgeted: 200, spent: 95, pct: 48 },
  ];

  return (
    <div className="space-y-3">
      <div className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-2.5">
        <ChevronLeft className="text-muted-foreground h-4 w-4" />
        <div className="text-center">
          <p className="text-sm font-medium">February 2026</p>
          <p className="text-success-text font-mono text-xs">€825 remaining</p>
        </div>
        <ChevronRight className="text-muted-foreground h-4 w-4" />
      </div>
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
              {/* RAD-575 — was `€{n.toLocaleString()}`: a hardcoded symbol in
                  front of a runtime-locale number, so it prefixed the euro even
                  in pt/es where it suffixes. <Amount> renders the parts in the
                  order the locale returns them. */}
              <Amount
                value={cat.budgeted}
                className="text-muted-foreground block text-right font-mono text-xs"
              />
              <Amount
                value={cat.spent}
                className="block text-right font-mono text-xs font-medium"
              />
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
      </div>
    </div>
  );
}

function MonthlyMetricsPreview() {
  const stats = [
    { label: "Budgeted", value: "€2,200", color: "" },
    { label: "Spent", value: "€1,675", color: "" },
    { label: "Remaining", value: "€525", color: "text-success-text" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="border-border bg-card rounded-lg border p-3"
          >
            <p className="text-muted-foreground text-[10px]">{stat.label}</p>
            <p className={`mt-1 font-mono text-sm font-semibold ${stat.color}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>
      <div className="border-border bg-card rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <div className="bg-success h-2 w-2 animate-pulse rounded-full" />
          <p className="text-muted-foreground text-xs">
            Auto-updated from your linked accounts
          </p>
        </div>
      </div>
    </div>
  );
}

function MonthlyRemainingPreview() {
  const rows = [
    {
      label: "This month",
      spent: "€1,675",
      budgeted: "€2,200",
      remaining: "€525",
      pct: 76,
    },
    {
      label: "Full year",
      spent: "€3,350",
      budgeted: "€26,400",
      remaining: "€23,050",
      pct: 13,
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

export function BudgetsMonthlyViewOnboarding() {
  const t = useTranslations();
  const user = useUser();
  const { data: onboardingData } = useOnboarding(user?.id);
  const [isMonthlyBudgetsOnboardingOpen, setIsMonthlyBudgetsOnboardingOpen] =
    useState(false);

  const shouldShowMonthlyBudgetsOnboarding = onboardingData?.onboarding.some(
    (o) => o.step === 4 && !o.done,
  );

  const updateOnboardingMutation = useUpdateOnboarding({
    userId: user?.id!,
    stepId: 4,
  });

  useEffect(() => {
    if (shouldShowMonthlyBudgetsOnboarding !== undefined) {
      const timer = setTimeout(() => {
        if (shouldShowMonthlyBudgetsOnboarding) {
          setIsMonthlyBudgetsOnboardingOpen(true);
          updateOnboardingMutation.mutate();
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [shouldShowMonthlyBudgetsOnboarding, updateOnboardingMutation]);

  const onboardingSlides = [
    {
      preview: <MonthlyBudgetTablePreview />,
      content: t("onboarding.budgets-monthly.content1"),
    },
    {
      preview: <MonthlyMetricsPreview />,
      content: t("onboarding.budgets-monthly.content2"),
    },
    {
      preview: <MonthlyRemainingPreview />,
      content: t("onboarding.budgets-monthly.content3"),
    },
  ];

  return (
    <DrawerDialog
      title={t("onboarding.budgets-monthly.title")}
      description={t("onboarding.budgets-monthly.description")}
      onOpen={() => updateOnboardingMutation.mutate()}
      open={isMonthlyBudgetsOnboardingOpen}
      onOpenChange={setIsMonthlyBudgetsOnboardingOpen}
      trigger={
        <LearningTip asButton>
          {t("onboarding.budgets-monthly.triggerLabel")}
        </LearningTip>
      }
    >
      <OnboardingCarousel
        slides={onboardingSlides}
        onComplete={() => setIsMonthlyBudgetsOnboardingOpen(false)}
        nextLabel={t("next")}
        completeLabel={t("got-it")}
      />
    </DrawerDialog>
  );
}
