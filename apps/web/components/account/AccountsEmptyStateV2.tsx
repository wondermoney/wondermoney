"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Landmark,
  Lock,
  MoveUpRight,
  PiggyBank,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { type ReactNode, useCallback, useState } from "react";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/help-hint";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { useRouter } from "@/i18n/navigation";
import {
  safelyRunDiagnostic,
  safePostHogCapture,
} from "@/lib/analytics/safe-diagnostics";
import { useUser } from "@/lib/auth/user-context";
import { getDocsLink } from "@/lib/docs-links";
import {
  cancelFirstRunHandoff,
  completeFirstRunHandoff,
  getFirstRunStepRoute,
} from "@/lib/onboarding/firstRunOnboarding";
import {
  formatPreviewAmount as fmt,
  PREVIEW_ACCOUNTS,
  PREVIEW_TOTAL_BALANCE,
} from "@/lib/preview/sample-accounts";
import { cn } from "@/lib/utils";
import {
  ACTIVATION_EVENTS,
  captureActivationEvent,
} from "@/lib/utils/analytics";

interface AccountsEmptyStateV2Props {
  recoveryState?: ReactNode;
}

export default function AccountsEmptyStateV2({
  recoveryState,
}: AccountsEmptyStateV2Props = {}) {
  const locale = useLocale();
  const t = useTranslations();
  const posthog = usePostHog();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useUser();
  const firstRunMode = searchParams.get("firstRun");
  const shouldOpenAdd = searchParams.get("add") === "true";

  const [accountAddModalIsOpen, setAccountAddModalIsOpen] = useState(
    shouldOpenAdd && !firstRunMode,
  );
  const [accountAddSyncModalIsOpen, setAccountAddSyncModalIsOpen] = useState(
    shouldOpenAdd && firstRunMode === "sync",
  );
  const [accountAddOfflineModalIsOpen, setAccountAddOfflineModalIsOpen] =
    useState(shouldOpenAdd && firstRunMode === "manual");
  const onAddSyncAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddSyncModalIsOpen(true);
    safePostHogCapture(posthog, "account_add_sync_modal", { action: "open" });
  };
  const onAddOfflineAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddOfflineModalIsOpen(true);
    safePostHogCapture(posthog, "account_add_offline_modal", {
      action: "open",
    });
  };

  const handleOfflineAccountSuccess = useCallback(async () => {
    if (
      completeFirstRunHandoff(
        "account",
        {
          accountStep: "manual_added",
          currentStep: "sync_value",
        },
        user?.id,
      )
    ) {
      safelyRunDiagnostic(() => {
        captureActivationEvent(posthog, ACTIVATION_EVENTS.firstAccountAdded, {
          account_count: 1,
          account_source: "manual",
          locale,
        });
        captureActivationEvent(
          posthog,
          ACTIVATION_EVENTS.onboardingStepCompleted,
          {
            account_source: "manual",
            step: "account",
          },
        );
      });
      router.replace(getFirstRunStepRoute("sync_value"));
    }
  }, [locale, posthog, router, user?.id]);

  const handleFirstRunAccountCancel = useCallback(() => {
    if (cancelFirstRunHandoff("account", "account", user?.id)) {
      router.replace(getFirstRunStepRoute("account"));
    }
  }, [router, user?.id]);

  // Balances and institutions come from the shared preview fixture so this
  // screen and Home describe the same fictional person; only the presentation
  // (which icon, which tint) belongs to this surface.
  const ACCOUNT_PRESENTATION = [
    { icon: Landmark, iconBg: "bg-info/10", iconColor: "text-info-text" },
    { icon: PiggyBank, iconBg: "bg-success/10", iconColor: "text-success-text" },
    { icon: CreditCard, iconBg: "bg-primary/10", iconColor: "text-primary" },
  ];
  const sampleAccounts = PREVIEW_ACCOUNTS.map((account, index) => ({
    ...account,
    ...ACCOUNT_PRESENTATION[index % ACCOUNT_PRESENTATION.length]!,
  }));

  const sampleTransactions = [
    {
      date: "Today",
      merchant: "Continente",
      category: "Groceries",
      amount: -47.3,
    },
    {
      date: "Today",
      merchant: "Padaria Lisboa",
      category: "Restaurants",
      amount: -4.2,
    },
    {
      date: "Yesterday",
      merchant: "Netflix",
      category: "Streaming Services",
      amount: -15.99,
    },
    {
      date: "Yesterday",
      merchant: "Uber",
      category: "Transport",
      amount: -8.5,
    },
    { date: "15 Feb", merchant: "Salary", category: "Income", amount: 2400.0 },
  ];

  const sampleTotal = PREVIEW_TOTAL_BALANCE;

  const docsHref = getDocsLink("accountsTransactions", locale);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {t("activation-source-of-truth-title")}
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("activation-source-of-truth-description")}
        </p>
      </div>

      {recoveryState}

      {/* Primary CTA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <AccountAddModal
          isOpen={accountAddModalIsOpen}
          setOpen={setAccountAddModalIsOpen}
          onAddSyncAccountClick={onAddSyncAccountClick}
          onAddOfflineAccountClick={onAddOfflineAccountClick}
          trigger={
            <Button size="lg" className="gap-2">
              <Plus className="size-4" />
              {t("add-account")}
            </Button>
          }
        />
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>{t("accounts-security-description")}</span>
        </div>
        <HelpHint href={docsHref}>{t("help-hint-accounts")}</HelpHint>
      </div>

      {/* Data-forward preview */}
      <div className="border-border bg-card rounded-xl border">
        <div className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
          {/* BRAND_GUIDELINES.md §8 forbids "What you'll get"-style feature-list
              framing on empty states; reuse the existing functional
              "Accounts overview" label instead. */}
          <span className="text-foreground text-sm font-medium">
            {t("accounts-overview")}
          </span>
          <PreviewBadge />
        </div>

        {/* DESIGN.md §9, observation 4: "the card is reserved for things that
            are genuinely a unit". The balance and the three metrics are one
            unit, so they sit on the canvas separated by hairlines instead of
            each being its own bordered, padded box nested inside this card.
            That removed a whole level of chrome — at 360px the old nesting spent
            16 + 24 + 20px of padding before the first digit. */}
        <div className="divide-border flex flex-col divide-y">
          {/* Total balance hero */}
          <div className="p-4 sm:p-6">
            <p className="text-muted-foreground text-sm">
              {t("total-balance")}
            </p>
            {/* Wraps as a unit: at 320–375px the amount alone fills the row,
                so the delta must drop to its own line rather than collide with
                it. min-w-0 lets the amount shrink instead of overflowing. */}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-foreground min-w-0 font-mono text-2xl font-semibold tracking-tight sm:text-3xl">
                {fmt(sampleTotal)}
              </span>
              <div className="flex min-w-0 items-center gap-1">
                <TrendingUp className="text-success-text h-3.5 w-3.5 shrink-0" />
                <span className="text-success-text font-mono text-sm font-medium whitespace-nowrap tabular-nums">
                  +{fmt(552.7)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("vs-previous-period")}
                </span>
              </div>
            </div>
          </div>

          {/* Metrics — hairline-separated on mobile, three columns from `sm`. */}
          <div className="divide-border grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowDownLeft className="text-muted-foreground h-3.5 w-3.5" />
                  <span className="text-muted-foreground text-sm">
                    {t("inflow")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <TrendingUp className="text-success-text h-3 w-3" />
                  <span className="text-success-text text-xs font-medium">
                    12%
                  </span>
                </div>
              </div>
              <p className="text-foreground mt-2 font-mono text-xl font-semibold tracking-tight">
                {fmt(2400)}
              </p>
            </div>
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="text-muted-foreground h-3.5 w-3.5" />
                  <span className="text-muted-foreground text-sm">
                    {t("outflow")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <TrendingDown className="text-success-text h-3 w-3" />
                  <span className="text-success-text text-xs font-medium">
                    8%
                  </span>
                </div>
              </div>
              <p className="text-foreground mt-2 font-mono text-xl font-semibold tracking-tight">
                {fmt(1847.3)}
              </p>
            </div>
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PiggyBank className="text-muted-foreground h-3.5 w-3.5" />
                  <span className="text-muted-foreground text-sm">
                    {t("savings-rate")}
                  </span>
                </div>
                <span className="text-success-text text-xs font-medium">
                  23.0%
                </span>
              </div>
              <p className="text-foreground mt-2 font-mono text-xl font-semibold tracking-tight">
                {fmt(552.7)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t("net-savings")}
              </p>
            </div>
          </div>

          {/* Spending by category */}
          <div>
            <div className="border-border border-b px-4 py-3 sm:px-6">
              <h2 className="text-foreground text-sm font-medium">
                {t("spending-by-category")}
              </h2>
            </div>
            <div className="divide-border divide-y">
              {[
                {
                  name: "Groceries",
                  amount: 320,
                  pct: 35,
                  color: "var(--chart-1)",
                },
                {
                  name: "Restaurants",
                  amount: 180,
                  pct: 20,
                  color: "var(--chart-2)",
                },
                {
                  name: "Transport",
                  amount: 95,
                  pct: 10,
                  color: "var(--chart-3)",
                },
                {
                  name: "Streaming Services",
                  amount: 65,
                  pct: 7,
                  color: "var(--chart-4)",
                },
              ].map((cat) => (
                <div
                  key={cat.name}
                  className="flex items-center gap-3 px-4 py-3 sm:px-6"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `color-mix(in oklch, ${cat.color} 12%, transparent)`,
                    }}
                  >
                    <Wallet className="h-4 w-4" style={{ color: cat.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground truncate text-sm">
                        {cat.name}
                      </span>
                      <span className="text-foreground shrink-0 font-mono text-sm font-medium">
                        {fmt(cat.amount)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${cat.pct}%`,
                            backgroundColor: `color-mix(in oklch, ${cat.color} 40%, transparent)`,
                          }}
                        />
                      </div>
                      <span className="text-muted-foreground w-8 text-right text-xs">
                        {cat.pct}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Balance growth chart placeholder */}
          <div>
            <div className="border-border border-b px-4 py-3 sm:px-6">
              <h2 className="text-foreground text-sm font-medium">
                {t("balance-growth")}
              </h2>
            </div>
            <div className="px-4 py-4 sm:px-6">
              <svg
                aria-hidden="true"
                viewBox="0 0 400 100"
                className="h-25 w-full"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="emptyStateGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="currentColor"
                      className="text-primary/20"
                    />
                    <stop
                      offset="100%"
                      stopColor="currentColor"
                      className="text-primary/0"
                    />
                  </linearGradient>
                </defs>
                <path
                  d="M0,80 C40,75 80,70 120,60 C160,50 200,55 240,40 C280,25 320,20 360,15 L400,10 L400,100 L0,100 Z"
                  fill="url(#emptyStateGradient)"
                />
                <path
                  d="M0,80 C40,75 80,70 120,60 C160,50 200,55 240,40 C280,25 320,20 360,15 L400,10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-primary/40"
                />
              </svg>
            </div>
          </div>

          {/* Accounts + Transactions grid */}
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <div>
                <div className="border-border border-b px-4 py-3 sm:px-6">
                  <h2 className="text-foreground text-sm font-medium">
                    {t("accounts")}
                  </h2>
                </div>
                <div className="divide-border divide-y">
                  {sampleAccounts.map((account) => (
                    <div
                      key={account.name}
                      className="flex items-center justify-between px-4 py-3.5 sm:px-6"
                    >
                      <div className="flex items-center gap-3">
                        <div className="bg-muted flex h-9 w-9 items-center justify-center rounded-lg">
                          <Wallet className="text-muted-foreground h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-foreground text-sm font-medium">
                            {account.name}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {account.institution}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "font-mono text-sm font-medium",
                          // A balance is a level — the minus sign carries the
                          // direction. § 9 rule 2.
                          "text-foreground",
                        )}
                      >
                        {fmt(account.balance)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              <div>
                <div className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
                  <h2 className="text-foreground text-sm font-medium">
                    {t("last-transactions")}
                  </h2>
                  <span className="text-primary text-xs font-medium">
                    {t("view-all")}{" "}
                    <MoveUpRight
                      strokeWidth={2}
                      className="ml-0.5 inline size-3"
                    />
                  </span>
                </div>
                <div className="divide-border divide-y">
                  {sampleTransactions.map((tx, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-4 py-3 sm:px-6"
                    >
                      {/* min-w-0 on the description and shrink-0 on the amount:
                          without them, "Yesterday · Subscriptions" refuses to
                          shrink at 360px and squeezes the amount until it breaks
                          between the minus sign and the digits ("-" / "€15.99"). */}
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                          <Wallet className="text-muted-foreground h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-foreground truncate text-sm">
                            {tx.merchant}
                          </p>
                          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <span className="shrink-0">{tx.date}</span>
                            <span className="shrink-0">·</span>
                            <span className="truncate">{tx.category}</span>
                          </div>
                        </div>
                      </div>
                      <span className="text-foreground shrink-0 pl-3 font-mono text-sm whitespace-nowrap tabular-nums">
                        {fmt(tx.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AccountAddSyncModal
        isOpen={accountAddSyncModalIsOpen}
        setOpen={(open) => {
          setAccountAddSyncModalIsOpen(open);
          if (!open) handleFirstRunAccountCancel();
        }}
      />
      <AccountAddOfflineModal
        isOpen={accountAddOfflineModalIsOpen}
        closeModal={() => setAccountAddOfflineModalIsOpen(false)}
        onCancel={handleFirstRunAccountCancel}
        onSuccess={handleOfflineAccountSuccess}
      />
    </div>
  );
}
