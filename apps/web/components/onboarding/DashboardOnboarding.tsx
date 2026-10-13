"use client";

import { CreditCard, Landmark, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { LearningTip } from "@/components/ui/learning-tip";
import useOnboarding from "@/lib/api/user/useOnboarding";
import useUpdateOnboarding from "@/lib/api/user/useUpdateOnboarding";
import { useUser } from "@/lib/auth/user-context";
import { consumeExistingOnboardingDrawerSuppression } from "@/lib/onboarding/firstRunOnboarding";
import {
  formatPreviewAmount,
  PREVIEW_TOTAL_BALANCE,
} from "@/lib/preview/sample-accounts";

import { DrawerDialog } from "../ui/dialog-responsive";
import { OnboardingCarousel } from "./OnboardingCarousel";

function NetWorthPreview() {
  const rows = [
    {
      icon: Landmark,
      name: "Bank Accounts",
      amount: formatPreviewAmount(PREVIEW_TOTAL_BALANCE),
      color: "text-info-text",
    },
    {
      icon: TrendingUp,
      name: "Investments",
      amount: "€24,680",
      color: "text-success-text",
    },
    {
      icon: CreditCard,
      name: "Credit Cards",
      amount: "-€1,430",
      color: "text-destructive-text",
    },
  ];

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium">Net worth</p>
      <div className="divide-border mt-3 divide-y">
        {rows.map((row) => (
          <div
            key={row.name}
            className="flex items-center justify-between py-2"
          >
            <div className="flex items-center gap-2">
              <row.icon className="text-muted-foreground h-4 w-4" />
              <span className="text-sm">{row.name}</span>
            </div>
            <span className={`font-mono text-sm font-medium ${row.color}`}>
              {row.amount}
            </span>
          </div>
        ))}
      </div>
      <div className="border-border mt-2 flex items-center justify-between border-t pt-2">
        <span className="text-sm font-medium">Total</span>
        <span className="font-mono text-lg font-semibold">€38,500</span>
      </div>
    </div>
  );
}

function BudgetHealthPreview() {
  const categories = [
    { name: "Housing", spent: 850, budgeted: 1200, pct: 71 },
    { name: "Food & Dining", spent: 420, budgeted: 500, pct: 84 },
  ];
  const topCategories = [
    { name: "Groceries", amount: "€280", color: "bg-info" },
    { name: "Restaurants", amount: "€140", color: "bg-primary" },
    { name: "Transport", amount: "€95", color: "bg-warning" },
  ];

  return (
    <div className="space-y-3">
      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium">
          Budget health
        </p>
        <div className="mt-3 space-y-3">
          {categories.map((cat) => (
            <div key={cat.name} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>{cat.name}</span>
                <span className="text-muted-foreground">
                  €{cat.spent} / €{cat.budgeted}
                </span>
              </div>
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${cat.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium">
          Top categories
        </p>
        <div className="mt-3 space-y-2">
          {topCategories.map((cat) => (
            <div
              key={cat.name}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${cat.color}`} />
                <span>{cat.name}</span>
              </div>
              <span className="font-mono text-sm font-medium">
                {cat.amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecentTransactionsPreview() {
  const transactions = [
    {
      merchant: "Lidl",
      category: "Groceries",
      date: "Today",
      amount: "-€42.30",
      color: "text-foreground",
    },
    {
      merchant: "Spotify",
      category: "Subscriptions",
      date: "Yesterday",
      amount: "-€9.99",
      color: "text-foreground",
    },
    {
      merchant: "Salary",
      category: "Income",
      date: "Feb 1",
      amount: "+€3,200",
      color: "text-success-text",
    },
  ];

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-medium">
          Recent transactions
        </p>
        <span className="text-primary text-xs">View all</span>
      </div>
      <div className="divide-border mt-3 divide-y">
        {transactions.map((tx) => (
          <div
            key={tx.merchant}
            className="flex items-center justify-between py-2"
          >
            <div>
              <p className="text-sm font-medium">{tx.merchant}</p>
              <p className="text-muted-foreground text-xs">
                {tx.date} &middot; {tx.category}
              </p>
            </div>
            <span className={`font-mono text-sm font-medium ${tx.color}`}>
              {tx.amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardOnboarding() {
  const t = useTranslations();
  const user = useUser();
  const { data: onboardingData } = useOnboarding(user?.id);
  const [isDashboardOnboardingOpen, setIsDashboardOnboardingOpen] =
    useState(false);
  const didSuppressFirstRunAutoOpenRef = useRef(false);

  const shouldShowDashboardOnboarding = onboardingData?.onboarding.some(
    (o) => o.step === 1 && !o.done,
  );

  const updateOnboardingMutation = useUpdateOnboarding({
    userId: user?.id!,
    stepId: 1,
  });
  const { mutate: completeDashboardOnboarding } = updateOnboardingMutation;

  useEffect(() => {
    if (shouldShowDashboardOnboarding !== undefined) {
      const timer = setTimeout(() => {
        if (shouldShowDashboardOnboarding) {
          if (didSuppressFirstRunAutoOpenRef.current) {
            return;
          }

          if (consumeExistingOnboardingDrawerSuppression()) {
            didSuppressFirstRunAutoOpenRef.current = true;
            return;
          }

          setIsDashboardOnboardingOpen(true);
          completeDashboardOnboarding();
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [completeDashboardOnboarding, shouldShowDashboardOnboarding]);

  const onboardingSlides = [
    {
      preview: <NetWorthPreview />,
      content: t("onboarding.dashboard.content1"),
    },
    {
      preview: <BudgetHealthPreview />,
      content: t("onboarding.dashboard.content2"),
    },
    {
      preview: <RecentTransactionsPreview />,
      content: t("onboarding.dashboard.content3"),
    },
  ];

  return (
    <DrawerDialog
      title={t("onboarding.dashboard.title")}
      description={t("onboarding.dashboard.description")}
      onOpen={() => completeDashboardOnboarding()}
      open={isDashboardOnboardingOpen}
      onOpenChange={setIsDashboardOnboardingOpen}
      trigger={
        <LearningTip asButton>
          {t("onboarding.dashboard.triggerLabel")}
        </LearningTip>
      }
    >
      <OnboardingCarousel
        slides={onboardingSlides}
        onComplete={() => setIsDashboardOnboardingOpen(false)}
        nextLabel={t("next")}
        completeLabel={t("got-it")}
      />
    </DrawerDialog>
  );
}
