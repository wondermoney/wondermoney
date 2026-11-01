"use client";

import { ArrowDownRight, ArrowUpRight, CircleHelp, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import useOnboarding from "@/lib/api/user/useOnboarding";
import useUpdateOnboarding from "@/lib/api/user/useUpdateOnboarding";
import { useUser } from "@/lib/auth/user-context";
import {
  formatPreviewAmount,
  PREVIEW_ACCOUNTS,
  PREVIEW_TOTAL_BALANCE,
} from "@/lib/preview/sample-accounts";

import { DrawerDialog } from "../ui/dialog-responsive";
import { LearningTip } from "../ui/learning-tip";
import { OnboardingCarousel } from "./OnboardingCarousel";

function BalanceOverviewPreview() {
  const t = useTranslations();

  // Shares the one preview fixture with Home and Accounts, so every preview
  // describes the same fictional person.
  return (
    <div className="divide-border border-border bg-card divide-y rounded-lg border">
      <div className="p-4">
        <p className="text-muted-foreground text-xs">{t("total-balance")}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="min-w-0 font-mono text-2xl font-semibold">
            {formatPreviewAmount(PREVIEW_TOTAL_BALANCE)}
          </p>
          <span className="text-success-text flex items-center gap-1">
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-xs font-medium">+2.4%</span>
          </span>
        </div>
      </div>
      {PREVIEW_ACCOUNTS.map((account) => (
        <div
          key={account.institution}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <Wallet className="text-muted-foreground h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{account.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {account.institution}
              </p>
            </div>
          </div>
          <span className="shrink-0 font-mono text-sm font-medium whitespace-nowrap tabular-nums">
            {formatPreviewAmount(account.balance)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MetricsPreview() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="border-border bg-card rounded-lg border p-3">
          <p className="text-muted-foreground text-[10px]">Inflow</p>
          <p className="text-success-text mt-1 font-mono text-sm font-semibold">
            €3,200
          </p>
          <div className="text-success-text mt-0.5 flex items-center gap-0.5">
            <ArrowUpRight className="h-3 w-3" />
            <span className="text-[10px]">+5.2%</span>
          </div>
        </div>
        <div className="border-border bg-card rounded-lg border p-3">
          <p className="text-muted-foreground text-[10px]">Outflow</p>
          <p className="mt-1 font-mono text-sm font-semibold">€2,100</p>
          <div className="text-destructive-text mt-0.5 flex items-center gap-0.5">
            <ArrowDownRight className="h-3 w-3" />
            <span className="text-[10px]">+8.1%</span>
          </div>
        </div>
        <div className="border-border bg-card rounded-lg border p-3">
          <p className="text-muted-foreground text-[10px]">Savings</p>
          <p className="text-success-text mt-1 font-mono text-sm font-semibold">
            €1,100
          </p>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-0.5">
            <span className="text-[10px]">34.4% rate</span>
          </div>
        </div>
      </div>
      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium">
          Balance growth
        </p>
        <svg
          aria-hidden="true"
          className="text-primary mt-2 h-16 w-full"
          viewBox="0 0 200 50"
          fill="none"
        >
          <path
            d="M0 40 C20 38, 40 35, 60 30 C80 25, 100 28, 120 22 C140 16, 160 12, 180 8 L200 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M0 40 C20 38, 40 35, 60 30 C80 25, 100 28, 120 22 C140 16, 160 12, 180 8 L200 5 L200 50 L0 50Z"
            fill="currentColor"
            fillOpacity="0.08"
          />
        </svg>
      </div>
    </div>
  );
}

function SpendingCategoriesPreview() {
  const categories = [
    { name: "Housing", amount: "€850", pct: 40 },
    { name: "Food & Dining", amount: "€420", pct: 20 },
    { name: "Transport", amount: "€180", pct: 9 },
  ];
  const transactions = [
    { merchant: "Rent Transfer", date: "Feb 1", amount: "-€850" },
    { merchant: "Lidl", date: "Feb 12", amount: "-€42.30" },
    { merchant: "Uber", date: "Feb 14", amount: "-€12.50" },
  ];

  return (
    <div className="space-y-3">
      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium">
          Spending by category
        </p>
        <div className="mt-3 space-y-2">
          {categories.map((cat) => (
            <div key={cat.name} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>{cat.name}</span>
                <span className="font-mono font-medium">{cat.amount}</span>
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
          Transactions
        </p>
        <div className="divide-border mt-2 divide-y">
          {transactions.map((tx) => (
            <div
              key={tx.merchant}
              className="flex items-center justify-between py-2"
            >
              <div>
                <p className="text-sm font-medium">{tx.merchant}</p>
                <p className="text-muted-foreground text-xs">{tx.date}</p>
              </div>
              <span className="font-mono text-sm font-medium">{tx.amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AccountsOnboarding() {
  const t = useTranslations();
  const user = useUser();
  const { data: onboardingData } = useOnboarding(user?.id);
  const [isAccountsOnboardingOpen, setIsAccountsOnboardingOpen] =
    useState(false);

  const shouldShowAccountsOnboarding = onboardingData?.onboarding.some(
    (o) => o.step === 2 && !o.done,
  );

  const updateOnboardingMutation = useUpdateOnboarding({
    userId: user?.id!,
    stepId: 2,
  });

  useEffect(() => {
    if (shouldShowAccountsOnboarding !== undefined) {
      const timer = setTimeout(() => {
        if (shouldShowAccountsOnboarding) {
          setIsAccountsOnboardingOpen(true);
          updateOnboardingMutation.mutate();
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [shouldShowAccountsOnboarding, updateOnboardingMutation]);

  const onboardingSlides = [
    {
      preview: <BalanceOverviewPreview />,
      content: t("onboarding.accounts.content1"),
    },
    {
      preview: <MetricsPreview />,
      content: t("onboarding.accounts.content2"),
    },
    {
      preview: <SpendingCategoriesPreview />,
      content: t("onboarding.accounts.content3"),
    },
  ];

  return (
    <DrawerDialog
      title={t("onboarding.accounts.title")}
      description={t("onboarding.accounts.description")}
      onOpen={() => {
        updateOnboardingMutation.mutate();
      }}
      open={isAccountsOnboardingOpen}
      onOpenChange={setIsAccountsOnboardingOpen}
      trigger={
        <LearningTip asButton>
          {t("onboarding.accounts.triggerLabel")}
        </LearningTip>
      }
    >
      <OnboardingCarousel
        slides={onboardingSlides}
        onComplete={() => setIsAccountsOnboardingOpen(false)}
        nextLabel={t("next")}
        completeLabel={t("got-it")}
      />
    </DrawerDialog>
  );
}
