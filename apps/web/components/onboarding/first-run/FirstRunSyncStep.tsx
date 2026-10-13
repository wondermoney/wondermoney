"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Landmark,
  Loader2,
  PiggyBank,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { clearBankAccountSyncReturnMarker } from "@/lib/account/bank-account-sync-return-marker";
import useBankAccountSyncStatus from "@/lib/api/banking/useBankAccountSyncStatus";
import { useUser } from "@/lib/auth/user-context";
import {
  connectReturnPatch,
  resolveConnectReturn,
} from "@/lib/onboarding/first-run/connect-return";
import {
  FIRST_RUN_EVENTS,
  getFirstRunState,
  getFirstRunStepRoute,
  patchFirstRunState,
} from "@/lib/onboarding/firstRunOnboarding";
import { cn } from "@/lib/utils";
import {
  ACTIVATION_EVENTS,
  captureActivationEvent,
} from "@/lib/utils/analytics";

import FirstRunIconTile, { type FirstRunIconTone } from "./FirstRunIconTile";
import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import { FirstRunSplit, FirstRunStepIntro } from "./FirstRunStepScaffold";

type SyncStatusKind = "processing" | "succeeded" | "partial" | "trouble";

/**
 * Real sync outcomes, so they take real semantic tokens (RAD-563) — the raw
 * ramps these replaced did not follow the theme.
 *
 * Drawn in the quiet register of DESIGN.md § 5: a hairline `-text/30` border
 * and `-text` ink on the page surface, with **no fill**. The fill is not a
 * stylistic omission. Measured on the light canvas, the ink this banner used to
 * carry sat on a 10% tint of its own hue at 3.20:1 (succeeded), 2.83:1
 * (partial) and 3.73:1 (trouble) — all three under 4.5:1, on 14px medium text
 * telling the user whether their bank sync worked. Dropping the tint and using
 * the `-text` tokens measures 5.33 / 5.37 / 5.60 light and 8.95 / 10.37 / 6.31
 * dark. The border is stronger than before too: 1.56:1 vs 1.32:1 light.
 *
 * `processing` loses its `bg-primary/5` for the same reason the others lose
 * theirs — one tinted state among four untinted ones is the register-mixing
 * § 5 warns about, and the wash measured 1.08:1 light / 1.05:1 dark against
 * the canvas, so nothing visible is being given up.
 */
const SYNC_STATUS_META: Record<
  SyncStatusKind,
  { icon: LucideIcon; classes: string; animateIcon?: boolean }
> = {
  processing: {
    icon: Loader2,
    classes: "border-primary/30 text-primary",
    animateIcon: true,
  },
  succeeded: {
    icon: CheckCircle2,
    classes: "border-success-text/30 text-success-text",
  },
  partial: {
    icon: AlertTriangle,
    classes: "border-warning-text/30 text-warning-text",
  },
  trouble: {
    icon: AlertTriangle,
    classes: "border-destructive-text/30 text-destructive-text",
  },
};

export default function FirstRunSyncStep() {
  const t = useTranslations("onboarding.firstRun");
  const user = useUser();
  const router = useRouter();
  const posthog = usePostHog();
  const setFooter = useFirstRunOnboardingFooter();
  const searchParams = useSearchParams();

  const result = useMemo(
    () => resolveConnectReturn(searchParams),
    [searchParams],
  );
  const applied = useRef(false);

  // Apply the return exactly once: mark connected, or bounce back on a hard failure.
  useEffect(() => {
    if (applied.current) return;
    if (!user?.id && result.kind !== "error_not_linked") return;
    applied.current = true;

    // RAD-600: record the return before acting on it. Every branch below either
    // redirects away or mutates state, and until now only the happy one emitted
    // anything — so a user who came back from the bank and landed in trouble was
    // indistinguishable from one who never came back at all.
    posthog?.capture(FIRST_RUN_EVENTS.accountConnectReturned, {
      outcome: result.kind,
      ...("error" in result ? { error: result.error } : {}),
    });

    if (result.kind === "error_not_linked") {
      clearBankAccountSyncReturnMarker();
      router.replace(
        `${getFirstRunStepRoute("account")}?connectError=${result.error}`,
      );
      return;
    }
    const patch = connectReturnPatch(result);
    if (patch && user?.id) {
      patchFirstRunState(patch, user.id);
      captureActivationEvent(
        posthog,
        ACTIVATION_EVENTS.onboardingStepCompleted,
        {
          account_step_status: "connected",
          step: "account",
        },
      );
      // RAD-600: the activation funnel's terminal event. It was emitted only
      // from the Accounts-page flow, so it went dark on 2026-07-25 when
      // first-run became the dominant route — the funnel had no end.
      // `captureActivationEvent` dedupes it per user, so a user who later adds
      // an account from the Accounts page does not double-count.
      if (result.kind === "connected") {
        captureActivationEvent(posthog, ACTIVATION_EVENTS.firstAccountAdded, {
          method: "bank_connection",
          source: "first_run",
        });
      }
    }
    if (result.kind === "connected") clearBankAccountSyncReturnMarker();
  }, [posthog, result, router, user?.id]);

  const incidentId =
    result.kind === "connected" || result.kind === "error_sync_trouble"
      ? result.incidentId
      : undefined;
  const { data: sync } = useBankAccountSyncStatus(incidentId);

  const state = getFirstRunState(user?.id);
  const isSkipped = state.accountStep === "skipped";
  const isManual = state.accountStep === "manual_added";

  useEffect(() => {
    setFooter(<FirstRunSyncFooter />);
    return () => setFooter(null);
  }, [setFooter]);

  const headline = isSkipped
    ? t("syncValue.skippedHeadline")
    : t("syncValue.connectedHeadline");
  const description = isSkipped
    ? t("syncValue.skippedDescription")
    : t("syncValue.connectedDescription");

  // Honest live status line for the connected path.
  let statusLine: string | null = null;
  let statusKind: SyncStatusKind | null = null;
  if (!isSkipped && !isManual) {
    if (sync?.state === "succeeded") {
      statusLine = t("connect.syncing.succeeded");
      statusKind = "succeeded";
    } else if (sync?.state === "partial") {
      statusLine = t("connect.syncing.partial");
      statusKind = "partial";
    } else if (
      sync?.state === "failed" ||
      result.kind === "error_sync_trouble"
    ) {
      statusLine = t("connect.syncing.trouble");
      statusKind = "trouble";
    } else if (incidentId) {
      statusLine = t("connect.syncing.processing");
      statusKind = "processing";
    }
  }
  const statusMeta = statusKind ? SYNC_STATUS_META[statusKind] : null;
  const StatusIcon = statusMeta?.icon;

  // RAD-623: the connected path is the highest-anxiety moment in first-run — the
  // user has just handed a bank consent to a product they installed minutes ago —
  // and it was also the emptiest screen: a spinner, a status line, and four
  // preview cards showing someone else's numbers. Two things fill that gap.
  //
  // `showInProgress` describes the work actually in flight, and only while it is
  // in flight. The three lines map to what the initial sync really does:
  // account details + balances, then transactions (the API requests a 365-day
  // window; banks cap it lower, hence "depending on what your bank shares"),
  // categorising each row as it lands. There is no per-stage progress on
  // `useBankAccountSyncStatus`, so these are deliberately not checklist items
  // with ticks — claiming a stage finished when we cannot know that is the one
  // thing this screen must not do.
  const showInProgress = statusKind === "processing";
  // The open-banking figure runs on the whole connected path, including
  // `trouble`, where reassurance is worth the most. It is normalisation proof,
  // not social proof: we have no user count worth showing, but "this is a
  // sixteen-million-connection habit, not an experiment" answers the actual
  // objection — *am I strange for doing this?* — and it is somebody else's
  // audited number, cited as such.
  const showOpenBankingNote = !isSkipped && !isManual && Boolean(statusKind);

  const cards: {
    icon: LucideIcon;
    tone: FirstRunIconTone;
    label: string;
    value: string;
    description: string;
    emphasize?: boolean;
  }[] = [
    {
      icon: Wallet,
      tone: "violet",
      label: t("syncValue.cards.balances.title"),
      value: t("preview.syncValue.balancesValue"),
      description: t("syncValue.cards.balances.description"),
    },
    {
      icon: ArrowLeftRight,
      tone: "sky",
      label: t("syncValue.cards.transactions.title"),
      value: t("preview.syncValue.transactionsValue"),
      description: t("syncValue.cards.transactions.description"),
    },
    {
      icon: PiggyBank,
      tone: "sky",
      label: t("syncValue.cards.budgets.title"),
      value: t("preview.syncValue.budgetSyncValue"),
      description: t("syncValue.cards.budgets.description"),
    },
    {
      icon: TrendingUp,
      tone: "green",
      label: t("syncValue.cards.netWorth.title"),
      value: t("preview.syncValue.netWorthSyncValue"),
      description: t("syncValue.cards.netWorth.description"),
      emphasize: true,
    },
  ];

  return (
    <FirstRunSplit
      copy={
        <div className="space-y-7">
          <FirstRunStepIntro
            kicker={t("stepLabels.sync_value")}
            headline={headline}
            sub={description}
          />
          {statusLine && statusMeta && StatusIcon ? (
            <div
              role="status"
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-sm font-medium",
                statusMeta.classes,
              )}
            >
              <StatusIcon
                className={cn(
                  "size-4 shrink-0",
                  statusMeta.animateIcon && "animate-spin",
                )}
              />
              <span>{statusLine}</span>
            </div>
          ) : null}
          {showInProgress ? (
            <div className="space-y-2.5">
              <p className="text-muted-foreground text-xs font-semibold tracking-[0.12em] uppercase">
                {t("syncValue.inProgress.title")}
              </p>
              <ul className="space-y-1.5">
                {[
                  t("syncValue.inProgress.balances"),
                  t("syncValue.inProgress.transactions"),
                  t("syncValue.inProgress.categories"),
                ].map((line) => (
                  <li
                    key={line}
                    className="text-muted-foreground flex gap-2.5 text-sm leading-6"
                  >
                    <span
                      aria-hidden="true"
                      className="bg-muted-foreground/50 mt-2.5 size-1 shrink-0 rounded-full"
                    />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="divide-border divide-y border-y">
            {cards.map((card) => (
              <div key={card.label} className="flex items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <FirstRunIconTile
                    icon={card.icon}
                    tone={card.tone}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="text-muted-foreground block text-sm font-medium">
                      {card.label}
                    </span>
                    <span className="text-muted-foreground block text-xs leading-5">
                      {card.description}
                    </span>
                  </span>
                  <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
                    {card.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {showOpenBankingNote ? (
            <div className="flex items-start gap-3.5">
              <FirstRunIconTile icon={Landmark} tone="slate" />
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-sm leading-6">
                  {t("syncValue.openBankingNote")}
                </p>
                <p className="text-muted-foreground/80 mt-1 text-xs leading-5">
                  {t("proofSources.openBankingLimited")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      }
      preview={null}
    />
  );
}

function FirstRunSyncFooter() {
  const t = useTranslations("onboarding.firstRun");
  const router = useRouter();
  const user = useUser();

  const handleContinue = () => {
    if (user?.id) patchFirstRunState({ currentStep: "completion" }, user.id);
    router.push(getFirstRunStepRoute("completion"));
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
