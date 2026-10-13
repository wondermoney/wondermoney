"use client";

import { Plus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import useOnboarding from "@/lib/api/user/useOnboarding";
import useUpdateOnboarding from "@/lib/api/user/useUpdateOnboarding";
import { useUser } from "@/lib/auth/user-context";

import { DrawerDialog } from "../ui/dialog-responsive";
import { LearningTip } from "../ui/learning-tip";
import { OnboardingCarousel } from "./OnboardingCarousel";

const SAMPLE_TRANSACTIONS = [
  {
    merchant: "Lidl",
    category: "Groceries",
    date: "Feb 15",
    amount: "-€42.30",
    color: "bg-info text-info-foreground",
  },
  {
    merchant: "Spotify",
    category: "Subscriptions",
    date: "Feb 14",
    amount: "-€9.99",
    color: "bg-primary text-primary-foreground",
  },
  {
    merchant: "Salary",
    category: "Income",
    date: "Feb 1",
    amount: "+€3,200",
    color: "bg-success text-success-foreground",
  },
  {
    merchant: "Amazon",
    category: "Shopping",
    date: "Jan 30",
    amount: "-€65.00",
    color: "bg-warning text-warning-foreground",
  },
  {
    merchant: "Uber",
    category: "Transport",
    date: "Jan 28",
    amount: "-€12.50",
    color: "bg-warning text-warning-foreground",
  },
];

function TransactionRow({ tx }: { tx: (typeof SAMPLE_TRANSACTIONS)[number] }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-3">
        <div
          className={`h-7 w-7 flex-shrink-0 rounded-full ${tx.color} flex items-center justify-center`}
        >
          <span className="text-[10px] font-bold">{tx.merchant[0]}</span>
        </div>
        <div>
          <p className="text-sm font-medium">{tx.merchant}</p>
          <p className="text-muted-foreground text-xs">
            {tx.date} &middot; {tx.category}
          </p>
        </div>
      </div>
      <span
        className={`font-mono text-sm font-medium ${tx.amount.startsWith("+") ? "text-success-text" : ""}`}
      >
        {tx.amount}
      </span>
    </div>
  );
}

function TransactionListPreview() {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="divide-border divide-y">
        {SAMPLE_TRANSACTIONS.map((tx) => (
          <TransactionRow key={tx.merchant} tx={tx} />
        ))}
      </div>
    </div>
  );
}

function FilteredTransactionsPreview() {
  const filters = ["Date range", "Account", "Category"];
  const filtered = SAMPLE_TRANSACTIONS.slice(0, 3);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <span
            key={f}
            className="border-border text-muted-foreground rounded-full border px-3 py-1 text-xs"
          >
            {f}
          </span>
        ))}
      </div>
      <div className="border-border bg-card rounded-lg border p-4">
        <div className="divide-border divide-y">
          {filtered.map((tx) => (
            <TransactionRow key={tx.merchant} tx={tx} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ImportActionsPreview() {
  const recent = SAMPLE_TRANSACTIONS.slice(0, 2);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border p-4">
          <div className="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-full">
            <Plus className="text-primary h-4 w-4" />
          </div>
          <span className="text-xs font-medium">Add transaction</span>
        </div>
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border p-4">
          <div className="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-full">
            <Upload className="text-primary h-4 w-4" />
          </div>
          <span className="text-xs font-medium">Import CSV</span>
        </div>
      </div>
      <div className="border-border bg-card rounded-lg border p-4">
        <div className="divide-border divide-y">
          {recent.map((tx) => (
            <TransactionRow key={tx.merchant} tx={tx} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AccountsTransactionsOnboarding() {
  const t = useTranslations();
  const user = useUser();
  const { data: onboardingData } = useOnboarding(user?.id);
  const [isTransactionsOnboardingOpen, setIsTransactionsOnboardingOpen] =
    useState(false);

  const shouldShowTransactionsOnboarding = onboardingData?.onboarding.some(
    (o) => o.step === 3 && !o.done,
  );

  const updateOnboardingMutation = useUpdateOnboarding({
    userId: user?.id!,
    stepId: 3,
  });

  useEffect(() => {
    if (shouldShowTransactionsOnboarding !== undefined) {
      const timer = setTimeout(() => {
        if (shouldShowTransactionsOnboarding) {
          setIsTransactionsOnboardingOpen(true);
          updateOnboardingMutation.mutate();
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [shouldShowTransactionsOnboarding, updateOnboardingMutation]);

  const onboardingSlides = [
    {
      preview: <TransactionListPreview />,
      content: t("onboarding.transactions.content1"),
    },
    {
      preview: <FilteredTransactionsPreview />,
      content: t("onboarding.transactions.content2"),
    },
    {
      preview: <ImportActionsPreview />,
      content: t("onboarding.transactions.content3"),
    },
  ];

  return (
    <DrawerDialog
      title={t("onboarding.transactions.title")}
      description={t("onboarding.transactions.description")}
      onOpen={() => updateOnboardingMutation.mutate()}
      open={isTransactionsOnboardingOpen}
      onOpenChange={setIsTransactionsOnboardingOpen}
      trigger={
        <LearningTip asButton>
          {t("onboarding.transactions.triggerLabel")}
        </LearningTip>
      }
    >
      <OnboardingCarousel
        slides={onboardingSlides}
        onComplete={() => setIsTransactionsOnboardingOpen(false)}
        nextLabel={t("next")}
        completeLabel={t("got-it")}
      />
    </DrawerDialog>
  );
}
