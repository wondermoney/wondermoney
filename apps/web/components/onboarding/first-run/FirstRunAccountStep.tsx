"use client";

import { FileText, KeyRound, Pencil, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";

import BankList from "@/components/account/BankList";
import StatementImportFlow, {
  useStatementImportAvailable,
} from "@/components/account/StatementImportFlow";
import { NoAccountOptionList } from "@/components/activation/NoAccountOptions";
import EnableBankingSetupWizard from "@/components/settings/BankProvider/EnableBankingSetupWizard";
import { useSimplefinAvailable } from "@/components/settings/Connections/SimplefinConnectButton";
import SimplefinConnectDialog from "@/components/settings/Connections/SimplefinConnectDialog";
import { Button } from "@/components/ui/button";
import { ComboBox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "@/i18n/navigation";
import { writableAccounts } from "@/lib/account/account-access";
import { saveBankAccountSyncReturnMarker } from "@/lib/account/bank-account-sync-return-marker";
import { useBankConnectionResult } from "@/lib/account/useBankConnectionResult";
import { track } from "@/lib/analytics/track";
import useAccounts from "@/lib/api/account/useAccounts";
import useCreateOfflineAccount from "@/lib/api/account/useCreateOfflineAccount";
import useBankList from "@/lib/api/banking/useBankList";
import useCreateRequisition from "@/lib/api/banking/useCreateRequisition";
import { useFeature } from "@/lib/api/instance/useInstance";
import useBankLinkCredential from "@/lib/api/user/useBankLinkCredential";
import { useUser } from "@/lib/auth/user-context";
import { buildOnboardingConnectRedirectPage } from "@/lib/onboarding/first-run/connect-redirect";
import {
  getFirstRunStepRoute,
  patchFirstRunState,
} from "@/lib/onboarding/firstRunOnboarding";
import { getCountryCodeClient } from "@/lib/utils/countries";
import { SUPPORTED_BANK_COUNTRY_CODES } from "@/lib/utils/countries/bank-countries";
import { countryFlags } from "@/lib/utils/countries/country-flag";
import { useAmountPlaceholder } from "@/lib/utils/currency-field";
import { parseLocaleNumber } from "@/lib/utils/number";

import FirstRunIconTile from "./FirstRunIconTile";
import { useFirstRunOnboardingFooter } from "./FirstRunOnboardingRouteShell";
import { FirstRunSplit, FirstRunStepIntro } from "./FirstRunStepScaffold";

/**
 * `choice` is where skipping the bank lands: the two ways in that need no bank key, importing a
 * statement or adding an account by hand, before going on without one.
 */
type Mode = "list" | "handoff" | "manual" | "choice";

export default function FirstRunAccountStep() {
  const t = useTranslations("onboarding.firstRun");
  // Root-scoped translator: "your-bank" lives at the top level (common.json), not
  // under onboarding.firstRun, so it needs its own unscoped useTranslations() call.
  const tCommon = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const user = useUser();
  const setFooter = useFirstRunOnboardingFooter();

  const [mode, setMode] = useState<Mode>("list");
  // Where the manual form's Back returns: the bank list or the no-bank choice.
  const [manualFrom, setManualFrom] = useState<"list" | "choice">("list");
  const [bankId, setBankId] = useState<string | null>(null);
  const [simplefinOpen, setSimplefinOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [country, setCountry] = useState<string>(
    () => getCountryCodeClient() || "PT",
  );
  // Sent back here by the Settings landing when the bank connection failed.
  const returnedError = useBankConnectionResult() === "error";

  // The user's own Enable Banking key, or the server's shared one when it covers this household.
  const {
    canLink,
    credentialRequired,
    loading: credentialLoading,
    sharedCredentialUnavailable,
  } = useBankLinkCredential();
  // Off when the operator's BANK_PROVIDERS leaves Enable Banking out (SimpleFIN only, say). An
  // older API without the list only had Enable Banking, so a missing list reads as on.
  const enableBankingAvailable = useFeature(
    (features) =>
      features.bankSyncProviders?.includes("enable_banking") ?? true,
  );
  const simplefinAvailable = useSimplefinAvailable();

  const countryOptions = Object.values(countryFlags)
    .filter((c) => SUPPORTED_BANK_COUNTRY_CODES.includes(c.code))
    .map((c) => ({ label: `${c.emoji} ${c.name}`, value: c.code }));

  const { data: banks = [], isLoading: banksLoading } = useBankList(country, {
    enabled: !!country && canLink && enableBankingAvailable,
    staleTime: Infinity,
  });
  const returnPage = buildOnboardingConnectRedirectPage(locale);
  const {
    data: requisition,
    isError: requisitionError,
    refetch: retryRequisition,
  } = useCreateRequisition(bankId!, {
    enabled: Boolean(bankId) && mode === "handoff",
    retry: false,
  });

  // Once the requisition redirect URL is ready, leave for the bank. The
  // effect runs once per URL; going back to the list clears it.
  const redirectUrl = mode === "handoff" ? requisition?.redirectUrl : undefined;
  const leaveForBank = useEffectEvent((url: string) => {
    // The last thing we can observe before the person leaves for the bank;
    // how it ends is the server's bank_connection_completed or _failed.
    track("bank_connection_started", { provider: "enable_banking" });
    saveBankAccountSyncReturnMarker(returnPage);
    window.location.href = url;
  });
  useEffect(() => {
    if (redirectUrl) leaveForBank(redirectUrl);
  }, [redirectUrl]);

  // The token is claimed and the first sync queued: the sync step shows its progress.
  const onSimplefinConnected = () => {
    if (user?.id)
      patchFirstRunState(
        { accountStep: "connected", currentStep: "sync_value" },
        user.id,
      );
    router.push(getFirstRunStepRoute("sync_value"));
  };

  const startConnect = (id: string) => {
    setBankId(id);
    setMode("handoff");
  };

  // Keep the skip control in the shell footer (empty while handing off). The
  // choice puts its own way on there; a child's effect runs before this one,
  // so this one leaves the footer alone then.
  useEffect(() => {
    if (mode === "choice") return;
    setFooter(
      mode === "handoff" ? null : (
        <AccountStepSkipButton onSkip={() => setMode("choice")} />
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
        }}
        t={t}
      />
    );
  }

  if (mode === "manual") {
    return (
      <ManualPanel
        onDone={() => router.push(getFirstRunStepRoute("sync_value"))}
        onBack={() => setMode(manualFrom)}
      />
    );
  }

  if (mode === "choice") {
    return (
      <NoBankChoice
        onBack={() => setMode("list")}
        onManual={() => {
          setManualFrom("choice");
          setMode("manual");
        }}
      />
    );
  }

  return (
    <>
      <FirstRunSplit
        copy={
          <div className="space-y-6">
            <FirstRunStepIntro
              headline={t("account.headline")}
              sub={t("account.description")}
            />

            {returnedError ? (
              // Quiet register (DESIGN.md): `-text` ink, no tint. The fill
              // token as text on its own 10% wash sat under 4.5:1.
              <div
                role="alert"
                className="border-destructive-text/30 text-destructive-text rounded-lg border p-3 text-sm"
              >
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
                onClick={() => {
                  setManualFrom("list");
                  setMode("manual");
                }}
              >
                {t("account.manualCta")}
              </Button>
            </div>

            {enableBankingAvailable || simplefinAvailable ? (
              <div className="flex items-center gap-3">
                <div className="border-border h-px flex-1 border-t" />
                <span className="text-muted-foreground text-xs">
                  {tCommon("or")}
                </span>
                <div className="border-border h-px flex-1 border-t" />
              </div>
            ) : null}

            {simplefinAvailable ? (
              <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-foreground text-sm font-medium">
                    {tCommon("simplefin.name")}
                  </p>
                  <p className="text-muted-foreground text-[13px] leading-5">
                    {tCommon("simplefin.offer")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => setSimplefinOpen(true)}
                >
                  {tCommon("simplefin.connect")}
                </Button>
              </div>
            ) : null}

            {!enableBankingAvailable ? null : credentialLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : credentialRequired ? (
              // The setup wizard opens here, in place: Settings is under (full-layout) and
              // guarded by FirstRunOnboardingRedirectGate, so a link there mid onboarding would
              // bounce back to the welcome step. Once the key is active the bank list below
              // replaces this card, so finishing the wizard lands on it.
              <div className="border-border text-muted-foreground flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <FirstRunIconTile icon={KeyRound} tone="slate" size="sm" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-foreground text-sm font-medium">
                      {t("account.credentialRequired.title")}
                    </p>
                    <p className="text-muted-foreground text-[13px] leading-5">
                      {t("account.credentialRequired.body")}
                    </p>
                    {sharedCredentialUnavailable ? (
                      <p className="text-muted-foreground text-[13px] leading-5">
                        {tCommon(
                          "bankProviderCredentialRequired.sharedUnavailable",
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  className="min-h-11 shrink-0"
                  onClick={() => setWizardOpen(true)}
                >
                  {tCommon("bankProviderCredentialRequired.cta")}
                </Button>
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
      <SimplefinConnectDialog
        open={simplefinOpen}
        onOpenChange={setSimplefinOpen}
        onConnected={onSimplefinConnected}
      />
      {/* Done closes it: the key is active, so the bank list is already showing. */}
      <EnableBankingSetupWizard
        entry="first_run"
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onChooseBank={() => {}}
      />
    </>
  );
}

function AccountStepSkipButton({ onSkip }: { onSkip: () => void }) {
  const t = useTranslations("onboarding.firstRun");

  return (
    <Button
      type="button"
      variant="ghost"
      className="text-muted-foreground min-h-11"
      onClick={() => {
        onSkip();
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
  const locale = useLocale();
  const user = useUser();
  const createOffline = useCreateOfflineAccount();
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [balanceInvalid, setBalanceInvalid] = useState(false);
  const amountPlaceholder = useAmountPlaceholder();

  const submit = () => {
    // Typed in the reader's locale ("1.234,56" for pt and es). Blank is a zero
    // balance; anything unreadable is refused rather than saved as 0.
    const currentBalance = balance.trim()
      ? parseLocaleNumber(balance, locale)
      : 0;
    if (currentBalance === null) {
      setBalanceInvalid(true);
      return;
    }
    createOffline.mutate(
      {
        name: name || tCommon("my-account"),
        currentBalance,
        // 151 is the app-default currency key (matches AccountCreateOfflineModal's default);
        // currencyId is a numeric currency key, not an ISO code.
        currencyId: "151",
      },
      {
        onSuccess: () => {
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
        headline={t("connect.manualTitle")}
        sub={t("connect.manualBody")}
      />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fr-manual-account-name">
            {t("connect.manualNameLabel")}
          </Label>
          <Input
            id="fr-manual-account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tCommon("account-name")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fr-manual-account-balance">
            {t("connect.manualBalanceLabel")}
          </Label>
          <Input
            id="fr-manual-account-balance"
            value={balance}
            onChange={(e) => {
              setBalance(e.target.value);
              setBalanceInvalid(false);
            }}
            inputMode="decimal"
            placeholder={amountPlaceholder}
            aria-invalid={balanceInvalid}
            aria-describedby={
              balanceInvalid ? "fr-manual-account-balance-error" : undefined
            }
          />
          {balanceInvalid && (
            <p
              id="fr-manual-account-balance-error"
              role="alert"
              className="text-destructive-text text-sm"
            >
              {tCommon("invalid-amount")}
            </p>
          )}
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

/**
 * After skipping the bank: the two ways in that work without a bank key, as one short choice,
 * then on without an account. Both lead into the existing flows (the import dialog, the manual
 * form) and come back here; an import that wrote its transactions moves on to the sync step as
 * a manual account would.
 */
function NoBankChoice({
  onBack,
  onManual,
}: {
  onBack: () => void;
  onManual: () => void;
}) {
  const t = useTranslations("onboarding.firstRun");
  const router = useRouter();
  const user = useUser();
  const setFooter = useFirstRunOnboardingFooter();
  const importAvailable = useStatementImportAvailable();
  const [importOpen, setImportOpen] = useState(false);
  // The import adds an account before its file, and leaving the import keeps
  // it: going on then is going on with a manual account, not skipping. The
  // account list says so, however the person got back here.
  const { data: accountsData } = useAccounts();
  const hasAccount = writableAccounts(accountsData?.accounts ?? []).length > 0;
  const userId = user?.id;

  useEffect(() => {
    const goOn = () => {
      if (hasAccount) {
        if (userId)
          patchFirstRunState(
            { accountStep: "manual_added", currentStep: "sync_value" },
            userId,
          );
      } else {
        track("onboarding_step_skipped", { step: "account" });
        if (userId)
          patchFirstRunState(
            { accountStep: "skipped", currentStep: "sync_value" },
            userId,
          );
      }
      router.push(getFirstRunStepRoute("sync_value"));
    };
    setFooter(
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground min-h-11"
        onClick={goOn}
      >
        {t("noBank.skip")}
      </Button>,
    );
    return () => setFooter(null);
  }, [hasAccount, router, setFooter, t, userId]);

  const onImported = () => {
    setImportOpen(false);
    if (user?.id)
      patchFirstRunState(
        { accountStep: "manual_added", currentStep: "sync_value" },
        user.id,
      );
    router.push(getFirstRunStepRoute("sync_value"));
  };

  return (
    <FirstRunSplit
      copy={
        <div className="space-y-6">
          <FirstRunStepIntro
            headline={t("noBank.headline")}
            sub={t("noBank.description")}
          />
          <NoAccountOptionList
            options={[
              ...(importAvailable
                ? [
                    {
                      key: "import",
                      icon: FileText,
                      label: t("noBank.import"),
                      hint: t("noBank.importHint"),
                      onSelect: () => setImportOpen(true),
                    },
                  ]
                : []),
              {
                key: "manual",
                icon: Pencil,
                label: t("noBank.manual"),
                hint: t("noBank.manualHint"),
                onSelect: onManual,
              },
            ]}
          />
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground min-h-11"
            onClick={onBack}
          >
            {t("noBank.connectInstead")}
          </Button>
          {importAvailable ? (
            <StatementImportFlow
              open={importOpen}
              onClose={() => setImportOpen(false)}
              onImported={onImported}
            />
          ) : null}
        </div>
      }
      preview={null}
    />
  );
}
