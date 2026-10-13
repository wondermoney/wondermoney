"use client";

import { KeyRound, Link as LinkIcon, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import BankList from "@/components/account/BankList";
import { Button } from "@/components/ui/button";
import { ComboBox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Link } from "@/components/ui/Link";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "@/i18n/navigation";
import { saveBankAccountSyncReturnMarker } from "@/lib/account/bank-account-sync-return-marker";
import useCreateOfflineAccount from "@/lib/api/account/useCreateOfflineAccount";
import useBankList from "@/lib/api/banking/useBankList";
import useCreateRequisition from "@/lib/api/banking/useCreateRequisition";
import useEnableBankingCredential from "@/lib/api/user/useEnableBankingCredential";
import { useUser } from "@/lib/auth/user-context";
import { buildOnboardingConnectRedirectPage } from "@/lib/onboarding/first-run/connect-redirect";
import {
  FIRST_RUN_EVENTS,
  getFirstRunState,
  getFirstRunStepRoute,
  patchFirstRunState,
} from "@/lib/onboarding/firstRunOnboarding";
import {
  ACTIVATION_EVENTS,
  captureActivationEvent,
} from "@/lib/utils/analytics";
import { isBankConnectionsPaused } from "@/lib/utils/bank-connections-paused";
import { getCountryCodeClient } from "@/lib/utils/countries";
import { SUPPORTED_BANK_COUNTRY_CODES } from "@/lib/utils/countries/bank-countries";
import { countryFlags } from "@/lib/utils/countries/country-flag";

import FirstRunIconTile from "./FirstRunIconTile";
import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import FirstRunSkipAccountDialog from "./FirstRunSkipAccountDialog";
import { FirstRunSplit, FirstRunStepIntro } from "./FirstRunStepScaffold";

type Mode = "list" | "handoff" | "manual";

export default function FirstRunAccountStep() {
  const t = useTranslations("onboarding.firstRun");
  // Root-scoped translator: "your-bank" lives at the top level (common.json), not
  // under onboarding.firstRun, so it needs its own unscoped useTranslations() call.
  const tCommon = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const user = useUser();
  const posthog = usePostHog();
  const setFooter = useFirstRunOnboardingFooter();
  const searchParams = useSearchParams();
  const state = getFirstRunState(user?.id);

  const [mode, setMode] = useState<Mode>("list");
  const [bankId, setBankId] = useState<string | null>(null);
  const [redirectStarted, setRedirectStarted] = useState(false);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [country, setCountry] = useState<string>(
    () => getCountryCodeClient() || "PT",
  );
  const returnedError = searchParams.get("connectError");

  const bankConnectionsPaused = isBankConnectionsPaused();
  // Gating order matches AccountCreateModal/AccountAddSyncModal: paused
  // (unchanged, first priority) takes precedence over the BYOK credential
  // check, which only runs once bank-sync isn't already paused globally.
  const { data: enableBankingCredential, isLoading: credentialLoading } =
    useEnableBankingCredential({ enabled: !bankConnectionsPaused });
  const credentialRequired =
    !bankConnectionsPaused &&
    !credentialLoading &&
    enableBankingCredential?.status !== "active";

  const countryOptions = Object.values(countryFlags)
    .filter((c) => SUPPORTED_BANK_COUNTRY_CODES.includes(c.code))
    .map((c) => ({ label: `${c.emoji} ${c.name}`, value: c.code }));

  const { data: banks = [], isLoading: banksLoading } = useBankList(country, {
    enabled: !!country && !bankConnectionsPaused && !credentialRequired,
    staleTime: Infinity,
  });
  const redirectPage = buildOnboardingConnectRedirectPage(locale);
  const {
    data: requisition,
    isError: requisitionError,
    refetch: retryRequisition,
  } = useCreateRequisition(bankId!, redirectPage, {
    enabled: Boolean(bankId) && mode === "handoff",
    retry: false,
  });

  // Once the requisition redirect URL is ready, leave for the bank.
  useEffect(() => {
    if (mode === "handoff" && requisition?.redirectUrl && !redirectStarted) {
      setRedirectStarted(true);
      // RAD-600: the last thing we can observe before the user leaves for the
      // bank. Without it, "picked a bank" and "came back" had nothing between
      // them, so a requisition that never produced a redirect was invisible.
      posthog?.capture(FIRST_RUN_EVENTS.accountBeforeRedirect, {
        bank_id: bankId,
      });
      saveBankAccountSyncReturnMarker(redirectPage);
      window.location.href = requisition.redirectUrl;
    }
  }, [
    mode,
    requisition?.redirectUrl,
    redirectStarted,
    redirectPage,
    posthog,
    bankId,
  ]);

  // RAD-600: a requisition either materialises or fails, and the failure has a
  // retry button — so a user could sit here retrying forever and produce no
  // telemetry at all. Both outcomes are now recorded.
  useEffect(() => {
    if (mode !== "handoff" || !requisition?.redirectUrl) return;
    posthog?.capture(FIRST_RUN_EVENTS.accountRequisitionCreated, {
      bank_id: bankId,
    });
  }, [mode, requisition?.redirectUrl, posthog, bankId]);

  useEffect(() => {
    if (mode !== "handoff" || !requisitionError) return;
    posthog?.capture(FIRST_RUN_EVENTS.accountRequisitionFailed, {
      bank_id: bankId,
    });
  }, [mode, requisitionError, posthog, bankId]);

  // RAD-600: bounced back from the sync step by a hard connect failure. This is
  // the one first-run outcome that already had a visible banner and no event.
  useEffect(() => {
    if (!returnedError) return;
    posthog?.capture(FIRST_RUN_EVENTS.accountConnectReturned, {
      error: returnedError,
      outcome: "error_not_linked",
    });
  }, [returnedError, posthog]);

  const startConnect = (id: string) => {
    setBankId(id);
    setMode("handoff");
    posthog?.capture(FIRST_RUN_EVENTS.accountConnectClicked, {
      bank_id: id,
      selected_goals: state.selectedGoals,
    });
  };

  // Keep the skip control in the shell footer (empty while handing off).
  useEffect(() => {
    setFooter(
      mode === "handoff" ? null : (
        <AccountStepSkipButton onSkip={() => setSkipDialogOpen(true)} />
      ),
    );
    return () => setFooter(null);
  }, [mode, setFooter]);

  if (mode === "handoff") {
    return (
      <HandoffPanel
        bankName={
          banks.find((b) => b.id === bankId)?.name ?? tCommon("your-bank")
        }
        error={requisitionError}
        onRetry={() => void retryRequisition()}
        onBack={() => {
          setMode("list");
          setBankId(null);
          setRedirectStarted(false);
        }}
        t={t}
      />
    );
  }

  if (mode === "manual") {
    return (
      <ManualPanel
        onDone={() => router.push(getFirstRunStepRoute("sync_value"))}
        onBack={() => setMode("list")}
      />
    );
  }

  return (
    <>
      <FirstRunSkipAccountDialog
        open={skipDialogOpen}
        title={t("account.skipWarning.headline")}
        description={t("account.skipWarning.description")}
        reassurance={t("account.skipWarning.reassurance")}
        primaryLabel={t("account.skipWarning.primary")}
        secondaryLabel={t("account.skipWarning.secondary")}
        onOpenChange={setSkipDialogOpen}
        onAddAccount={() => setSkipDialogOpen(false)}
        onConfirmSkip={() => {
          setSkipDialogOpen(false);
          posthog?.capture(FIRST_RUN_EVENTS.accountSkipConfirmed, {
            selected_goals: state.selectedGoals,
          });
          posthog?.capture(FIRST_RUN_EVENTS.stepSkipped, {
            step: "account",
            selected_goals: state.selectedGoals,
          });
          captureActivationEvent(
            posthog,
            ACTIVATION_EVENTS.onboardingStepCompleted,
            {
              account_step_status: "skipped",
              skipped: true,
              step: "account",
            },
          );
          if (user?.id)
            patchFirstRunState(
              { accountStep: "skipped", currentStep: "sync_value" },
              user.id,
            );
          router.push(getFirstRunStepRoute("sync_value"));
        }}
      />

      <FirstRunSplit
        copy={
          <div className="space-y-6">
            <FirstRunStepIntro
              kicker={t("stepLabels.account")}
              headline={t("account.headline")}
              sub={t("account.description")}
            />

            {returnedError ? (
              <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
                {t("connect.connectErrorBanner")}
              </div>
            ) : null}

            {/* Parallel path, same visual weight as bank connect: a user who doesn't
                want to link a bank should see this before scrolling the bank list. */}
            <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <p className="text-foreground text-sm font-medium">
                  {t("connect.manualTitle")}
                </p>
                <p className="text-muted-foreground text-[13px] leading-5">
                  {t("connect.manualBody")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                onClick={() => setMode("manual")}
              >
                {t("account.manualCta")}
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="border-border h-px flex-1 border-t" />
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {tCommon("or")}
              </span>
              <div className="border-border h-px flex-1 border-t" />
            </div>

            {bankConnectionsPaused ? (
              <div className="border-border bg-muted/40 text-muted-foreground flex items-start gap-3 rounded-md border p-3">
                <FirstRunIconTile icon={LinkIcon} tone="slate" size="sm" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-foreground text-sm font-medium">
                    {tCommon("bankConnectionsPaused.title")}
                  </p>
                  <p className="text-muted-foreground text-[13px] leading-5">
                    {tCommon("bankConnectionsPaused.body")}
                  </p>
                  <Link
                    href="/faq"
                    className="text-primary text-xs font-semibold underline underline-offset-2"
                  >
                    {tCommon("bankConnectionsPaused.cta")}
                  </Link>
                </div>
              </div>
            ) : credentialLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : credentialRequired ? (
              // Onboarding-specific copy, not the shared bankProviderCredentialRequired
              // keys: those point to /settings, which is under (full-layout) and
              // guarded by FirstRunOnboardingRedirectGate — following that link mid
              // onboarding would bounce the user straight back to the welcome step
              // instead of Settings. This copy stays local and instead points at the
              // manual-account card above and the skip control in the footer, both of
              // which already work here.
              <div className="border-border bg-muted/40 text-muted-foreground flex items-start gap-3 rounded-md border p-3">
                <FirstRunIconTile icon={KeyRound} tone="slate" size="sm" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-foreground text-sm font-medium">
                    {t("account.credentialRequired.title")}
                  </p>
                  <p className="text-muted-foreground text-[13px] leading-5">
                    {t("account.credentialRequired.body")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fr-onboarding-country">
                    {t("connect.countryLabel")}
                  </Label>
                  <ComboBox
                    id="fr-onboarding-country"
                    btnVariant="input"
                    defaultValue={country}
                    options={countryOptions}
                    onSelect={(opt) => setCountry(opt?.value ?? "")}
                  />
                </div>

                {banksLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : (
                  <BankList bankList={banks} onClick={startConnect} />
                )}
              </>
            )}

            <div className="border-border bg-muted/30 flex items-start gap-3 rounded-md border p-3">
              <FirstRunIconTile icon={ShieldCheck} tone="slate" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium">
                  {t("account.trustShort")}
                </p>
                <p className="text-muted-foreground mt-1 text-[13px] leading-6">
                  {t("account.trustLong")}
                </p>
              </div>
            </div>
          </div>
        }
        preview={null}
      />
    </>
  );
}

function AccountStepSkipButton({ onSkip }: { onSkip: () => void }) {
  const t = useTranslations("onboarding.firstRun");
  const user = useUser();
  const posthog = usePostHog();
  const state = getFirstRunState(user?.id);

  return (
    <Button
      type="button"
      variant="ghost"
      className="text-muted-foreground min-h-11"
      onClick={() => {
        onSkip();
        posthog?.capture(FIRST_RUN_EVENTS.accountSkipWarningViewed, {
          selected_goals: state.selectedGoals,
        });
      }}
    >
      {t("skipStep")}
    </Button>
  );
}

function HandoffPanel({
  bankName,
  error,
  onRetry,
  onBack,
  t,
}: {
  bankName: string;
  error: boolean;
  onRetry: () => void;
  onBack: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-10 text-center">
      {error ? (
        <>
          <p className="text-base font-medium">{t("connect.handoffError")}</p>
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={onBack}>
              {t("back")}
            </Button>
            <Button type="button" onClick={onRetry}>
              {t("connect.retry")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Spinner />
          <h2 className="text-xl font-semibold tracking-tight">
            {t("connect.handoffTitle", { bank: bankName })}
          </h2>
          <p className="text-muted-foreground max-w-sm text-sm leading-6">
            {t("connect.handoffBody")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("connect.handoffSecurity")}
          </p>
        </>
      )}
    </div>
  );
}

function ManualPanel({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("onboarding.firstRun");
  // Root-scoped translator: "account-name" and "my-account" live at the top level
  // (common.json), not under onboarding.firstRun, so they need their own unscoped
  // useTranslations() call (matches AccountCreateOfflineModal's usage of these keys).
  const tCommon = useTranslations();
  const user = useUser();
  const posthog = usePostHog();
  const createOffline = useCreateOfflineAccount();
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");

  const submit = () => {
    createOffline.mutate(
      {
        name: name || tCommon("my-account"),
        currentBalance: Number(balance) || 0,
        // 151 is the app-default currency key (matches AccountCreateOfflineModal's default);
        // currencyId is a numeric currency key, not an ISO code.
        currencyId: "151",
      },
      {
        onSuccess: () => {
          posthog?.capture(FIRST_RUN_EVENTS.manualAccountClicked, {
            selected_goals: getFirstRunState(user?.id).selectedGoals,
          });
          captureActivationEvent(
            posthog,
            ACTIVATION_EVENTS.onboardingStepCompleted,
            {
              account_step_status: "manual_added",
              step: "account",
            },
          );
          if (user?.id)
            patchFirstRunState(
              { accountStep: "manual_added", currentStep: "sync_value" },
              user.id,
            );
          onDone();
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <FirstRunStepIntro
        kicker={t("stepLabels.account")}
        headline={t("connect.manualTitle")}
        sub={t("connect.manualBody")}
      />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t("connect.manualNameLabel")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tCommon("account-name")}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("connect.manualBalanceLabel")}</Label>
          <Input
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {t("connect.manualNote")}
        </p>
        <div className="flex justify-between">
          <Button type="button" variant="ghost" onClick={onBack}>
            {t("back")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            loading={createOffline.isPending}
            disabled={createOffline.isPending}
          >
            {t("connect.manualSubmit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
